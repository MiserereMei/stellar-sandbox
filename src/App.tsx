import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Simulation } from './lib/Simulation';
import { CanvasView } from './components/CanvasView';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { TimeJumpOverlay } from './components/TimeJumpOverlay';
import { AIChat } from './components/AIChat';
import { AutopilotConsole } from './components/AutopilotConsole';
import { StreamingHUD } from './components/StreamingHUD';
import { AnimatePresence } from 'motion/react';

export type ToolMode = 'select' | 'add' | 'ruler';
export type AddMode = 'orbit' | 'static' | 'velocity';
export type BodyPreset = { name: string, mass: number, radius: number, colorType: string };
export type VisualSettings = {
  warpEnabled: boolean;
  gridEnabled: boolean;
  starsEnabled: boolean;
  trailsEnabled: boolean;
};

export type ActivePopUp = 'ai' | 'add' | 'settings' | 'jump' | null;

export default function App() {
  const sim = useMemo(() => new Simulation(), []);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [addMode, setAddMode] = useState<AddMode>('orbit');
  const [creationPreset, setCreationPreset] = useState<BodyPreset>({ name: 'Planet', mass: 100, radius: 10, colorType: 'planet' });
  const [selectedBodyId, setSelectedBodyId] = useState<string | null>(null);
  const [activePopUp, setActivePopUp] = useState<ActivePopUp>(null);
  const [visualSettings, setVisualSettings] = useState<VisualSettings>({
    warpEnabled: true,
    gridEnabled: true,
    starsEnabled: true,
    trailsEnabled: true,
  });
  const [showAutopilot, setShowAutopilot] = useState(false);
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('stellar_api_key') || '');
  const [streamingMode, setStreamingMode] = useState(false);
  const [autopilotLogs, setAutopilotLogs] = useState<{ time: number; msg: string }[]>([]);

  const addAutopilotLog = useCallback((msg: string) => {
    setAutopilotLogs(prev => [...prev.slice(-99), { time: sim.missionTime, msg }]);
  }, [sim]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Shift+S → toggle streaming mode
      if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        setStreamingMode(v => !v);
      }
      // Ctrl+Enter → Launch: unpause + engage autopilot + streaming mode
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        sim.paused = false;
        if (sim.currentScript && !sim.isAutopilotActive) {
          try {
            sim.startAutopilot(sim.currentScript, addAutopilotLog);
          } catch (_) { /* ignore compile errors on launch */ }
        }
        setStreamingMode(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sim, addAutopilotLog]);


  const handleSetApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('stellar_api_key', key);
  };

  const onSelectBody = React.useCallback((id: string | null) => {
    setSelectedBodyId(id);
    if (id) setShowAutopilot(false);
  }, []);

  const handleSetActivePopUp = React.useCallback((val: ActivePopUp) => {
    setActivePopUp(val);
  }, []);

  return (
    <div className={`w-screen h-screen bg-[var(--color-bg-deep)] text-[var(--color-text-main)] font-sans overflow-hidden flex flex-col selection:bg-[var(--color-accent-blue)]/30 relative${streamingMode ? ' streaming-mode' : ''}`}>
      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden w-full relative">
        {/* Viewport */}
        <main className="flex-1 relative overflow-hidden bg-[var(--color-bg-deep)]">
          <CanvasView
            sim={sim}
            toolMode={toolMode}
            setToolMode={setToolMode}
            addMode={addMode}
            creationPreset={creationPreset}
            onSelectBody={onSelectBody}
            selectedBodyId={selectedBodyId}
            visualSettings={visualSettings}
            setActivePopUp={handleSetActivePopUp}
          />
        </main>

        <TimeJumpOverlay sim={sim} />
        <StreamingHUD sim={sim} isStreaming={streamingMode} autopilotLogs={autopilotLogs} />

        {/* Toolbar & Sidebars — hidden in streaming mode */}
        {!streamingMode && (
          <>
            <Toolbar
              sim={sim}
              toolMode={toolMode}
              setToolMode={setToolMode}
              addMode={addMode}
              setAddMode={setAddMode}
              creationPreset={creationPreset}
              setCreationPreset={setCreationPreset}
              activePopUp={activePopUp}
              setActivePopUp={setActivePopUp}
              visualSettings={visualSettings}
              setVisualSettings={setVisualSettings}
              showAutopilot={showAutopilot}
              setShowAutopilot={(val) => {
                setShowAutopilot(val);
                if (val) setSelectedBodyId(null);
              }}
              streamingMode={streamingMode}
              setStreamingMode={setStreamingMode}
              apiKey={apiKey}
              setApiKey={handleSetApiKey}
            />

            <AnimatePresence mode="wait">
              {selectedBodyId ? (
                <Sidebar
                  key="sidebar"
                  sim={sim}
                  selectedBodyId={selectedBodyId}
                  onClose={() => setSelectedBodyId(null)}
                />
              ) : showAutopilot ? (
                <AutopilotConsole
                  key="autopilot"
                  sim={sim}
                  onAddLog={addAutopilotLog}
                  onClose={() => setShowAutopilot(false)}
                />
              ) : null}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}
