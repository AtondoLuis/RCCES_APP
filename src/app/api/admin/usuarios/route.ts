import { apiError, requireAdmin, requireSameOrigin, AccessError } from "@/lib/admin-access";
import { inviteAppUser, listAppUsers, updateAppUser } from "@/lib/user-admin";
export async function GET(request: Request) {
  try {
    const context = await requireAdmin();
    const page = Number(new URL(request.url).searchParams.get("page") ?? 0);
    if (!Number.isSafeInteger(page) || page < 0) throw new AccessError(400, "Pagina invalida.");
    return Response.json(await listAppUsers(context, page), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
async function mutate(request: Request, invite: boolean) {
  try {
    requireSameOrigin(request);
    const context = await requireAdmin();
    let body: unknown;
    try { body = await request.json(); } catch { throw new AccessError(400, "JSON invalido."); }
    return Response.json(invite ? await inviteAppUser(context, body) : await updateAppUser(context, body), { status: invite ? 201 : 200 });
  } catch (error) { return apiError(error); }
}
export const POST = (request: Request) => mutate(request, true);
export const PATCH = (request: Request) => mutate(request, false);
