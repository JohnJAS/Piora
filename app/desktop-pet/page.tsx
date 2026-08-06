import { DesktopCompanionWindow } from "@/components/DesktopCompanionWindow";
import { I18nProvider } from "@/hooks/useI18n";

export default function DesktopPetPage() {
  return (
    <I18nProvider>
      <DesktopCompanionWindow />
    </I18nProvider>
  );
}
