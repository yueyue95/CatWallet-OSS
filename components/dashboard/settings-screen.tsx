"use client";

import { Globe, Palette, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { type OAuthProfile } from "@/lib/auth/profile";
import { useI18n } from "@/lib/i18n";
import { isSupportedCurrency } from "@/lib/i18n/currency";

function SettingsCard({
  children,
  description,
  icon: Icon,
  title,
}: Readonly<{
  children: React.ReactNode;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}>) {
  return (
    <Card className="border-border bg-card card-shadow">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Icon className="size-5 text-primary" />
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function getInitials(name: string) {
  return (
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "D"
  );
}

type I18n = ReturnType<typeof useI18n>;

function ProfileAvatarRow({
  profile,
  fallbackValue,
}: Readonly<{ profile: OAuthProfile; fallbackValue: string }>) {
  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-16 border-2 border-primary">
        {profile.avatarUrl ? (
          <AvatarImage
            src={profile.avatarUrl}
            alt={profile.fullName}
            referrerPolicy="no-referrer"
          />
        ) : null}
        <AvatarFallback className="bg-linear-to-br from-primary to-emerald-400 text-xl font-bold text-primary-foreground">
          {getInitials(profile.fullName)}
        </AvatarFallback>
      </Avatar>
      <div>
        <p className="font-semibold text-foreground">{profile.fullName}</p>
        <p className="text-sm text-muted-foreground">
          {profile.email || fallbackValue}
        </p>
      </div>
    </div>
  );
}

function ReadOnlyProfileField({
  id,
  label,
  type,
  value,
}: Readonly<{
  id?: string;
  label: string;
  type?: string;
  value: string;
}>) {
  return (
    <div className="space-y-2">
      {id ? <Label htmlFor={id}>{label}</Label> : <Label>{label}</Label>}
      <Input id={id} type={type} value={value} readOnly />
    </div>
  );
}

function ProfileFieldsGrid({
  firstName,
  lastName,
  onFirstNameChange,
  onLastNameChange,
  profile,
  formatDate,
  fallbackValue,
  t,
}: Readonly<{
  firstName: string;
  lastName: string;
  onFirstNameChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
  profile: OAuthProfile;
  formatDate: I18n["formatDate"];
  fallbackValue: string;
  t: I18n["t"];
}>) {
  const createdAtValue = profile.createdAt
    ? formatDate(profile.createdAt, { dateStyle: "medium", timeStyle: "short" })
    : fallbackValue;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="firstName">{t("screen.settings.firstName")}</Label>
        <Input
          id="firstName"
          maxLength={80}
          onChange={(event) => onFirstNameChange(event.target.value)}
          value={firstName}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="lastName">{t("screen.settings.lastName")}</Label>
        <Input
          id="lastName"
          maxLength={80}
          onChange={(event) => onLastNameChange(event.target.value)}
          value={lastName}
        />
      </div>
      <ReadOnlyProfileField
        id="email"
        type="email"
        label={t("screen.settings.email")}
        value={profile.email || fallbackValue}
      />
      <ReadOnlyProfileField
        label={t("settings.createdAt")}
        value={createdAtValue}
      />
    </div>
  );
}

function ProfileSettingsCard({
  profile,
  formatDate,
  fallbackValue,
  saveProfile,
  t,
}: Readonly<{
  profile: OAuthProfile;
  formatDate: I18n["formatDate"];
  fallbackValue: string;
  saveProfile: (input: {
    firstName: string;
    lastName: string;
  }) => Promise<void>;
  t: I18n["t"];
}>) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [saveState, setSaveState] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [isPending, startTransition] = useTransition();
  const previewName =
    [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") ||
    profile.fullName;
  const previewProfile = {
    ...profile,
    firstName,
    lastName,
    fullName: previewName,
  };

  function submitProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveState("idle");
    startTransition(async () => {
      try {
        await saveProfile({ firstName, lastName });
        setSaveState("success");
        router.refresh();
      } catch {
        setSaveState("error");
      }
    });
  }

  return (
    <SettingsCard
      icon={User}
      title={t("screen.settings.profile")}
      description={t("screen.settings.profileDescription")}
    >
      <ProfileAvatarRow
        profile={previewProfile}
        fallbackValue={fallbackValue}
      />
      <Separator />
      <form className="space-y-4" onSubmit={submitProfile}>
        <ProfileFieldsGrid
          firstName={firstName}
          lastName={lastName}
          onFirstNameChange={(value) => {
            setFirstName(value);
            setSaveState("idle");
          }}
          onLastNameChange={(value) => {
            setLastName(value);
            setSaveState("idle");
          }}
          profile={profile}
          formatDate={formatDate}
          fallbackValue={fallbackValue}
          t={t}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={isPending} type="submit">
            {isPending
              ? t("screen.settings.savingProfile")
              : t("screen.settings.saveProfile")}
          </Button>
          {saveState === "success" ? (
            <p className="text-sm text-emerald-600" role="status">
              {t("screen.settings.profileSaved")}
            </p>
          ) : null}
          {saveState === "error" ? (
            <p className="text-sm text-destructive" role="alert">
              {t("screen.settings.profileSaveError")}
            </p>
          ) : null}
        </div>
      </form>
    </SettingsCard>
  );
}

function AppearanceSettingsCard({ t }: Readonly<{ t: I18n["t"] }>) {
  return (
    <SettingsCard
      icon={Palette}
      title={t("screen.settings.appearance")}
      description={t("screen.settings.appearanceDescription")}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium text-foreground">
            {t("screen.settings.theme")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("screen.settings.themeDescription")}
          </p>
        </div>
        <ThemeToggle />
      </div>
    </SettingsCard>
  );
}

function CurrencySelectField({
  currency,
  setCurrency,
  t,
}: Readonly<{
  currency: I18n["currency"];
  setCurrency: I18n["setCurrency"];
  t: I18n["t"];
}>) {
  return (
    <div className="space-y-2">
      <Label>{t("screen.settings.currency")}</Label>
      <Select
        value={currency}
        onValueChange={(value) =>
          setCurrency(isSupportedCurrency(value) ? value : "MYR")
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="BRL">BRL (R$)</SelectItem>
          <SelectItem value="USD">USD ($)</SelectItem>
          <SelectItem value="EUR">EUR (€)</SelectItem>
          <SelectItem value="MYR">MYR (RM)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function LanguageSelectField({
  locale,
  setLocale,
  t,
}: Readonly<{
  locale: I18n["locale"];
  setLocale: I18n["setLocale"];
  t: I18n["t"];
}>) {
  return (
    <div className="space-y-2">
      <Label>{t("screen.settings.language")}</Label>
      <Select
        value={locale}
        onValueChange={(value) => {
          if (value === "pt-BR") {
            setLocale("pt-BR");
            return;
          }
          if (value === "zh-CN") {
            setLocale("zh-CN");
            return;
          }
          setLocale("en");
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="en">English</SelectItem>
          <SelectItem value="pt-BR">Português</SelectItem>
          <SelectItem value="zh-CN">简体中文</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function RegionalSettingsCard({
  currency,
  setCurrency,
  locale,
  setLocale,
  t,
}: Readonly<{
  currency: I18n["currency"];
  setCurrency: I18n["setCurrency"];
  locale: I18n["locale"];
  setLocale: I18n["setLocale"];
  t: I18n["t"];
}>) {
  return (
    <SettingsCard
      icon={Globe}
      title={t("screen.settings.regional")}
      description={t("screen.settings.regionalDescription")}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CurrencySelectField
          currency={currency}
          setCurrency={setCurrency}
          t={t}
        />
        <LanguageSelectField locale={locale} setLocale={setLocale} t={t} />
      </div>
    </SettingsCard>
  );
}

type SettingsScreenProps = {
  readonly profile: OAuthProfile;
  readonly saveProfile: (input: {
    firstName: string;
    lastName: string;
  }) => Promise<void>;
};

export function SettingsScreen({ profile, saveProfile }: SettingsScreenProps) {
  const { currency, formatDate, locale, setCurrency, setLocale, t } = useI18n();
  const fallbackValue = t("settings.notAvailable");

  return (
    <main className="max-w-4xl">
      <PageHeader
        title={t("screen.settings.title")}
        description={t("screen.settings.description")}
      />

      <div className="space-y-6">
        <ProfileSettingsCard
          profile={profile}
          saveProfile={saveProfile}
          formatDate={formatDate}
          fallbackValue={fallbackValue}
          t={t}
        />
        <AppearanceSettingsCard t={t} />
        <RegionalSettingsCard
          currency={currency}
          setCurrency={setCurrency}
          locale={locale}
          setLocale={setLocale}
          t={t}
        />
      </div>
    </main>
  );
}
