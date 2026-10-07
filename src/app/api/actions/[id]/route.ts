import { z } from "zod";
import { endpoint, body } from "@/lib/http";
import { getAction, saveAction } from "@/features/exits/store";
import { reconcile } from "@/features/exits/service";
import { AppError } from "@/lib/errors";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return endpoint(request, async () => {
    const input = z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        operation: z.enum(["status", "reject"]),
      })
      .parse(await body(request));
    const { id } = await params;
    const action = await getAction(z.uuid().parse(id), input.token);
    if (input.operation === "reject") {
      if (action.status !== "prepared")
        throw new AppError(
          "ALREADY_SUBMITTED",
          "A submitted or uncertain action must be reconciled.",
          409,
        );
      action.status = "rejected";
      action.updatedAt = Date.now();
      await saveAction(action);
      return action;
    }
    return await reconcile(action);
  });
}
