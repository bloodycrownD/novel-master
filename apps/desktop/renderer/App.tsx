import { NovelMasterProvider, useNovelMaster } from "./providers/NovelMasterProvider";

function AppContent() {
  const { status } = useNovelMaster();

  if (status === "ready") {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <h1>Runtime ready</h1>
        <p>Novel Master desktop runtime is connected via IPC.</p>
      </main>
    );
  }

  return null;
}

export function App() {
  return (
    <NovelMasterProvider>
      <AppContent />
    </NovelMasterProvider>
  );
}
