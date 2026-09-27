import { AppShell } from "@/components/dashboard/app-shell";
import { SettingsScreen } from "@/components/dashboard/settings-screen";
import { updateDisplayNameAction } from "@/app/settings/actions";
import { getOAuthProfile } from "@/lib/auth/profile";

export default async function SettingsPage() {
  const profile = await getOAuthProfile();

  return (
    <AppShell>
      <SettingsScreen profile={profile} saveProfile={updateDisplayNameAction} />
    </AppShell>
  );
}
