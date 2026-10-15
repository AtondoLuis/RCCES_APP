import { getLiturgy, isLiturgicalDate } from "@/lib/liturgy";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!isLiturgicalDate(date)) {
    return Response.json({ error: "Fecha inválida. Usa YYYY-MM-DD." }, { status: 400 });
  }
  try {
    return Response.json(await getLiturgy(date));
  } catch {
    return Response.json({ error: "No se pudo obtener la información litúrgica automáticamente." }, { status: 502 });
  }
}
