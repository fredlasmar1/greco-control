import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <h1 className="text-4xl font-bold text-muted-foreground mb-2">404</h1>
      <p className="text-muted-foreground mb-6">Página não encontrada</p>
      <Link href="/">
        <Button className="bg-[#01696F] hover:bg-[#0C4E54] text-white">
          Voltar ao Dashboard
        </Button>
      </Link>
    </div>
  );
}
