"use client";

import { BRAND_FILE_PREFIX } from "@/lib/brand";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { TabIntro } from "@/components/layout/TabIntro";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settingsStore";
import { ApiKeySetup } from "@/components/ai/ApiKeySetup";
import { InlineHelp } from "@/components/help/InlineHelp";
import {
  exportAllStorage,
  importAllStorage,
} from "@/lib/storage";
import {
  Download,
  KeyRound,
  Loader2,
  Moon,
  Save,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  Upload,
  User,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth, ROLE_LABELS } from "@/lib/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { logAudit } from "@/lib/audit";
import { AuditLogPanel } from "@/components/settings/AuditLogPanel";

export default function SettingsPage() {
  const settings = useSettingsStore((s) => s.settings);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const { toast } = useToast();
  const { user, profile, refreshProfile } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    setFullName(profile?.full_name ?? "");
    setCompany(profile?.company ?? "");
  }, [profile?.full_name, profile?.company]);

  function onExport() {
    const json = exportAllStorage();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${BRAND_FILE_PREFIX}-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Настройки экспортированы", variant: "success" });
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const ok = importAllStorage(text);
    if (ok) {
      toast({
        title: "Настройки импортированы",
        description: "Обновите страницу для применения.",
        variant: "success",
      });
    } else {
      toast({ title: "Неверный формат файла", variant: "destructive" });
    }
    e.target.value = "";
  }

  async function onSaveProfile(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSavingProfile(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: fullName.trim() || null,
          company: company.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);
      if (error) {
        toast({
          title: "Не удалось сохранить профиль",
          description: error.message,
          variant: "destructive",
        });
      } else {
        await refreshProfile();
        toast({ title: "Профиль обновлён", variant: "success" });
      }
    } catch (err) {
      toast({
        title: "Ошибка сохранения",
        description: err instanceof Error ? err.message : "Неизвестная ошибка",
        variant: "destructive",
      });
    } finally {
      setSavingProfile(false);
    }
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast({
        title: "Пароль слишком короткий",
        description: "Минимум 6 символов.",
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      toast({
        title: "Пароли не совпадают",
        variant: "destructive",
      });
      return;
    }
    setSavingPassword(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) {
        toast({
          title: "Не удалось обновить пароль",
          description: error.message,
          variant: "destructive",
        });
      } else {
        setNewPassword("");
        setNewPasswordConfirm("");
        if (user) {
          void logAudit(supabase, user.id, "password_changed");
        }
        toast({ title: "Пароль обновлён", variant: "success" });
      }
    } catch (err) {
      toast({
        title: "Ошибка обновления пароля",
        description: err instanceof Error ? err.message : "Неизвестная ошибка",
        variant: "destructive",
      });
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <PageContainer
      icon={<SettingsIcon className="h-5 w-5" />}
      title="Настройки"
      description="Профиль, API-ключи, тема и резервные копии."
    >
      <TabIntro
        lead="Профиль, API-ключ Claude, тема и резервные копии."
        points={[
          { title: "API-ключ", text: "Чтобы работал AI-анализ, добавьте ключ Anthropic (хранится зашифрованным, в браузер не отдаётся)." },
          { title: "Резервная копия", text: "Экспорт и импорт ваших настроек и конфигураций в JSON-файл." },
          { title: "Внешний вид", text: "Тема оформления и параметры отображения." },
        ]}
      />

      <div className="max-w-3xl mx-auto space-y-5">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 border border-brand-500/30 text-brand-500">
                <User className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Профиль</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Данные хранятся в Supabase. Email и роль меняет только
                  администратор.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={onSaveProfile}
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              <div className="space-y-2">
                <Label>Имя</Label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ваше имя"
                />
              </div>
              <div className="space-y-2">
                <Label>Компания</Label>
                <Input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Например, Arrow Media"
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  value={user?.email ?? ""}
                  readOnly
                  disabled
                  className="opacity-70"
                />
              </div>
              <div className="space-y-2">
                <Label>Роль</Label>
                <div className="flex h-10 items-center">
                  {profile?.role ? (
                    <span className="inline-flex items-center rounded-md border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-500">
                      {ROLE_LABELS[profile.role]}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </div>
              </div>
              <div className="md:col-span-2">
                <Button
                  type="submit"
                  variant="gradient"
                  disabled={savingProfile}
                >
                  {savingProfile ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Сохранение…
                    </>
                  ) : (
                    <>
                      <Save />
                      Сохранить профиль
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 border border-brand-500/30 text-brand-500">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Сменить пароль</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Минимум 6 символов. После смены сессия останется активной.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={onChangePassword}
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              <div className="space-y-2">
                <Label htmlFor="newPassword">Новый пароль</Label>
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Минимум 6 символов"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPasswordConfirm">Подтвердите</Label>
                <Input
                  id="newPasswordConfirm"
                  type="password"
                  autoComplete="new-password"
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  placeholder="Повторите пароль"
                />
              </div>
              <div className="md:col-span-2">
                <Button
                  type="submit"
                  variant="outline"
                  disabled={savingPassword}
                >
                  {savingPassword ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Обновление…
                    </>
                  ) : (
                    <>
                      <KeyRound />
                      Обновить пароль
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <InlineHelp title="Как это работает: ключ Claude (зачем и где взять)">
          <p>
            AI-анализ работает на вашем личном ключе{" "}
            <b className="text-foreground">Claude (Anthropic)</b> — это значит, что
            запросы идут от вашего имени и оплачиваются по вашему тарифу у
            Anthropic, а мы не шлём ваши данные в чужие модели от себя.
          </p>
          <p>
            Ключ создаётся бесплатно в консоли Anthropic (ссылка «как получить
            ключ» ниже). Вставьте его — он{" "}
            <b className="text-foreground">шифруется и хранится на сервере</b>, на
            клиент не возвращается. Остальные провайдеры (GPT, Gemini и др.) — скоро.
          </p>
        </InlineHelp>

        <ApiKeySetup />

        <Card>
          <CardHeader>
            <CardTitle>Внешний вид</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center gap-3">
                {settings.theme === "dark" ? (
                  <Moon className="h-4 w-4" />
                ) : (
                  <Sun className="h-4 w-4" />
                )}
                <div>
                  <Label htmlFor="theme" className="cursor-pointer">
                    Тёмная тема
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Переключайтесь между светлой и тёмной темой.
                  </p>
                </div>
              </div>
              <Switch
                id="theme"
                checked={settings.theme === "dark"}
                onCheckedChange={(v) => setTheme(v ? "dark" : "light")}
              />
            </div>
          </CardContent>
        </Card>

        <AuditLogPanel />

        <Card>
          <CardHeader>
            <CardTitle>Резервное копирование</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={onExport}>
                <Download />
                Экспорт всех настроек
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={onImport}
              />
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
              >
                <Upload />
                Импорт
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Экспорт сохраняет все источники, датасеты, визуализации, историю
              AI-анализов и настройки в один JSON-файл.
            </p>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
