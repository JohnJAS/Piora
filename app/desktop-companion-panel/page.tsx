import { CompanionPanel } from "@/components/CompanionPanel";
import { I18nProvider } from "@/hooks/useI18n";

export default function DesktopCompanionPanelPage() {
  return (
    <I18nProvider>
      <CompanionPanel />
    </I18nProvider>
  );
}
