/**
 * Greco Control — Importador automático do CSV de agendamentos da Trinks
 *
 * COMO INSTALAR (5 minutos):
 *  1. Vá em https://script.google.com → "Novo projeto"
 *  2. Apague o conteúdo padrão e cole TODO este arquivo
 *  3. No topo, ajuste as 2 constantes abaixo (URL_API e TOKEN)
 *  4. Salve (Ctrl+S) e dê um nome ao projeto (ex: "Greco Trinks CSV")
 *  5. Clique no relógio (⏰ Triggers) à esquerda → "Adicionar Trigger":
 *       - Função:               importarTrinksCsv
 *       - Implantação:          Cabeçalho
 *       - Origem do evento:     Acionado por tempo
 *       - Tipo de acionador:    Temporizador por hora
 *       - Intervalo:            A cada 1 hora
 *     → Salvar (vai pedir autorização do Gmail — aceite)
 *  6. (Opcional) Rode "importarTrinksCsv" UMA vez no editor pra testar
 *
 * O QUE FAZ:
 *  - Roda a cada hora
 *  - Procura emails recentes de atendimento@trinks.com com anexo CSV
 *  - Faz POST do CSV pro endpoint do sistema (autenticado por token)
 *  - Marca o email com label "Greco-Importado" pra não reprocessar
 */

// ─── CONFIGURAÇÃO (ajuste estas 2 linhas) ────────────────────────────────────

const URL_API = "https://grecocontrol.com.br/api/trinks-csv/agendamentos";

// Token de auth (deve bater com a env TRINKS_CSV_TOKEN configurada no Railway).
// Gere um valor aleatório (ex: openssl rand -hex 32) e use o MESMO nos dois lugares.
const TOKEN = "COLE_AQUI_O_MESMO_TOKEN_DO_RAILWAY";

// ─── Constantes internas ─────────────────────────────────────────────────────

const REMETENTE = "atendimento@trinks.com";
const LABEL_NOME = "Greco-Importado";

// ─── Função principal (chamada pelo trigger) ─────────────────────────────────

function importarTrinksCsv() {
  const label = obterOuCriarLabel(LABEL_NOME);

  // Busca emails dos últimos 2 dias do remetente que NÃO foram processados
  const query = `from:${REMETENTE} has:attachment -label:${LABEL_NOME} newer_than:2d`;
  const threads = GmailApp.search(query, 0, 20);
  Logger.log(`[Greco] Encontradas ${threads.length} thread(s) pendentes`);

  let processados = 0;
  let erros = 0;

  for (const thread of threads) {
    const messages = thread.getMessages();
    for (const msg of messages) {
      const anexos = msg.getAttachments({
        includeInlineImages: false,
        includeAttachments: true,
      });

      for (const att of anexos) {
        const nome = att.getName() || "";
        if (!/\.csv$/i.test(nome)) continue;

        try {
          const conteudo = att.getBytes();
          const csvBase64 = Utilities.base64Encode(conteudo);
          const resp = UrlFetchApp.fetch(URL_API, {
            method: "post",
            contentType: "application/json",
            headers: { "X-Csv-Token": TOKEN, "X-Email-From": REMETENTE },
            payload: JSON.stringify({ csvBase64, from: msg.getFrom(), assunto: msg.getSubject() }),
            muteHttpExceptions: true,
          });
          const code = resp.getResponseCode();
          const body = resp.getContentText();
          if (code >= 200 && code < 300) {
            Logger.log(`[Greco] ✅ ${nome} importado: ${body}`);
            processados++;
          } else {
            Logger.log(`[Greco] ⚠️ HTTP ${code} em ${nome}: ${body}`);
            erros++;
          }
        } catch (err) {
          Logger.log(`[Greco] ❌ Erro processando ${nome}: ${err}`);
          erros++;
        }
      }
    }
    // Marca a thread inteira como processada (mesmo que tenha anexos não-CSV)
    thread.addLabel(label);
    thread.markRead();
  }

  Logger.log(`[Greco] Concluído. Processados: ${processados}, Erros: ${erros}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function obterOuCriarLabel(nome) {
  let label = GmailApp.getUserLabelByName(nome);
  if (!label) label = GmailApp.createLabel(nome);
  return label;
}

// ─── Função de histórico (rodar manualmente quando precisar) ─────────────────
//
// COMO USAR pra puxar emails dos últimos N dias:
//  1. No menu superior do editor, escolha "importarHistoricoTrinks"
//  2. Antes de Run, edite a chamada abaixo (last line) com o número de dias
//     que você quer pra trás (ex: 11 pra cobrir 01-11 do mês atual)
//  3. Clique ▶ Run
//
// IMPORTANTE: essa função NÃO usa label, então pode reprocessar emails que
// já foram importados antes — mas como o backend MESCLA, isso é seguro: os
// mesmos agendamentos não duplicam.
function importarHistoricoTrinks(dias) {
  const N = Number(dias) || 14;
  Logger.log(`[Greco] Importando histórico dos últimos ${N} dias…`);
  // Sem filtro de label — reprocessa tudo do período
  const query = `from:${REMETENTE} has:attachment newer_than:${N}d`;
  const threads = GmailApp.search(query, 0, 100);
  Logger.log(`[Greco] ${threads.length} thread(s) no período`);

  let processados = 0, erros = 0;
  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      const anexos = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
      for (const att of anexos) {
        if (!/\.csv$/i.test(att.getName() || "")) continue;
        try {
          const csvBase64 = Utilities.base64Encode(att.getBytes());
          const resp = UrlFetchApp.fetch(URL_API, {
            method: "post",
            contentType: "application/json",
            headers: { "X-Csv-Token": TOKEN, "X-Email-From": REMETENTE },
            payload: JSON.stringify({ csvBase64, from: msg.getFrom(), assunto: msg.getSubject() }),
            muteHttpExceptions: true,
          });
          const code = resp.getResponseCode();
          if (code >= 200 && code < 300) {
            Logger.log(`[Greco] ✅ ${msg.getDate()} → ${resp.getContentText().slice(0, 200)}`);
            processados++;
          } else {
            Logger.log(`[Greco] ⚠️ HTTP ${code}: ${resp.getContentText()}`);
            erros++;
          }
          Utilities.sleep(500); // 0.5s entre uploads pra não saturar
        } catch (err) {
          Logger.log(`[Greco] ❌ ${err}`);
          erros++;
        }
      }
    }
  }
  Logger.log(`[Greco] Histórico concluído. ok=${processados} err=${erros}`);
}

// Atalhos pra rodar diretamente do menu (clique nessas funções):
function importarUltimos7Dias()  { importarHistoricoTrinks(7); }
function importarUltimos14Dias() { importarHistoricoTrinks(14); }
function importarUltimos30Dias() { importarHistoricoTrinks(30); }
