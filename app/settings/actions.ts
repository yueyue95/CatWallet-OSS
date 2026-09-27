"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { authNameMaxLength } from "@/lib/auth/email-password";
import { encryptField } from "@/lib/crypto/field-encryption";
import { createClient } from "@/lib/supabase/server";

const profileNamePartSchema = z
  .string()
  .trim()
  .max(authNameMaxLength)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "Invalid control characters",
  });

const updateDisplayNameSchema = z
  .object({
    firstName: profileNamePartSchema.min(1),
    lastName: profileNamePartSchema,
  })
  .strict()
  .refine(
    ({ firstName, lastName }) =>
      Array.from([firstName, lastName].filter(Boolean).join(" ")).length <= 160,
    { message: "Display name is too long" },
  );

export type UpdateDisplayNameInput = z.infer<typeof updateDisplayNameSchema>;

export async function updateDisplayNameAction(data: unknown): Promise<void> {
  const parsed = updateDisplayNameSchema.parse(data);
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    throw new Error("Unauthenticated");
  }

  const fullName = [parsed.firstName, parsed.lastName]
    .filter(Boolean)
    .join(" ");
  const { error } = await supabase
    .from("profiles")
    .update({ name: encryptField(fullName) })
    .eq("id", userData.user.id);

  if (error) {
    throw new Error("Profile update failed", { cause: error });
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
}
