import { CompanionBubbleWindow } from "@/components/CompanionBubbleWindow";
import { I18nProvider } from "@/hooks/useI18n";

export default function DesktopCompanionBubblePage() {
  return (
    <I18nProvider>
      <CompanionBubbleWindow />
    </I18nProvider>
  );
}
