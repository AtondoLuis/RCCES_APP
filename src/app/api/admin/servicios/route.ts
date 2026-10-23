import { z } from "zod";
import { AccessError, apiError, requireAdmin, requireSameOrigin } from "@/lib/admin-access";
const schema = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).optional(), slug: z.string().trim().min(1).optional(),
  display_order: z.number().int().optional(), active: z.boolean().optional(), allow_multiple_people: z.boolean().optional(),
  required_servers: z.number().int().min(1).max(2147483647).optional() }).strict();
export async function PATCH(request: Request) {
  try {
    requireSameOrigin(request);
    const { client } = await requireAdmin();
    let body: unknown;
    try { body = await request.json(); } catch { throw new AccessError(400, "JSON invalido."); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new AccessError(400, "Servidores requeridos debe ser un entero mayor o igual a 1.");
    const { id, ...patch } = parsed.data;
    const result = await client.from("services").update(patch).eq("id", id).select("id").maybeSingle();
    if (result.error) throw new AccessError(400, "No se pudo actualizar el servicio.");
    if (!result.data) throw new AccessError(404, "Servicio no encontrado.");
    return Response.json(result.data);
  } catch (error) { return apiError(error); }
}
