import { AssistantRuntimeProvider, AuiConfig, Tools, useLocalRuntime } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { AsciiBackground } from "./ascii-bg";
import { TooltipProvider } from "@/components/ui/tooltip";
import { flyoverAdapter, suggestionAdapter, uploadAdapter } from "./flyover";
import { toolkit } from "./toolkit";
import { loadLibrary } from "./settings";

void loadLibrary();

const config = AuiConfig({ tools: Tools({ toolkit }) });

export default function App() {
  const runtime = useLocalRuntime(flyoverAdapter, { adapters: { suggestion: suggestionAdapter, attachments: uploadAdapter } });
  return (
    <AssistantRuntimeProvider runtime={runtime} config={config}>
      <TooltipProvider>
        <AsciiBackground />
        <div className="h-dvh">
          <Thread />
        </div>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
