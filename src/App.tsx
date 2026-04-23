import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Simulation } from './lib/Simulation';
import { CanvasView } from './components/CanvasView';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { TimeJumpOverlay } from './components/TimeJumpOverlay';
import { AIChat } from './components/AIChat';
import { AutopilotConsole } from './components/AutopilotConsole';
import { StreamingHUD } from './components/StreamingHUD';
import { Outliner } from './components/Outliner';
import { AnimatePresence } from 'motion/react';
import EditorWindow from './components/EditorWindow';

export type ToolMode = 'select' | 'add' | 'ruler';
export type AddMode = 'orbit' | 'static' | 'velocity';
export type BodyPreset = { name: string, mass: number, radius: number, colorType: string };
export type VisualSettings = {
  warpEnabled: boolean;
  gridEnabled: boolean;
  starsEnabled: boolean;
  trailsEnabled: boolean;
};
export type EngineSettings = {
  wasmEnabled: boolean;
  physicsMode: 'optimal' | 'preset' | 'custom';
  physicsPreset: number;
};

export type ActivePopUp = 'ai' | 'add' | 'settings' | 'jump' | null;

export default function App() {
  // If we are in Editor mode, just render the EditorWindow
  if (window.location.search.includes('editor=')) {
    return <EditorWindow />;
  }

  const sim = useMemo(() => new Simulation(), []);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [addMode, setAddMode] = useState<AddMode>('orbit');
  const [creationPreset, setCreationPreset] = useState<BodyPreset>({ name: 'Planet', mass: 100, radius: 10, colorType: 'planet' });
  const [selectedBodyId, setSelectedBodyId] = useState<string | null>(null);
  const [activePopUp, setActivePopUp] = useState<ActivePopUp>(null);
  const [visualSettings, setVisualSettings] = useState<VisualSettings>(() => {
    const saved = localStorage.getItem('stellar_visual_settings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse visual settings", e);
      }
    }
    return {
      warpEnabled: true,
      gridEnabled: true,
      starsEnabled: true,
      trailsEnabled: true,
    };
  });

  const [engineSettings, setEngineSettings] = useState<EngineSettings>(() => {
    const saved = localStorage.getItem('stellar_engine_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          wasmEnabled: false, // Force false by default
          physicsMode: parsed.physicsMode ?? 'optimal',
          physicsPreset: parsed.physicsPreset ?? 2
        };
      } catch (e) { console.error(e); }
    }
    return { wasmEnabled: false, physicsMode: 'optimal', physicsPreset: 2 };
  });

  // Save Engine Settings
  useEffect(() => {
    localStorage.setItem('stellar_engine_settings', JSON.stringify(engineSettings));
    // Apply wasm status to sim
    sim.wasmPhysics.forceDisabled = !engineSettings.wasmEnabled;
  }, [engineSettings, sim]);

  // Save Visual Settings
  useEffect(() => {
    localStorage.setItem('stellar_visual_settings', JSON.stringify(visualSettings));
  }, [visualSettings]);
  const [showOutliner, setShowOutliner] = useState(false);
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('stellar_api_key') || '');
  const [streamingMode, setStreamingMode] = useState(false);
  const [autopilotLogs, setAutopilotLogs] = useState<{ time: number; msg: string }[]>([]);
  const [lastAction, setLastAction] = useState<(() => void) | null>(null);

  const addAutopilotLog = useCallback((msg: string) => {
    (window as any)._logBuffer = (window as any)._logBuffer || [];
    (window as any)._logBuffer.push({ time: sim.missionTime, msg });
    console.debug(`%c${sim.missionTime.toFixed(1)}s: %c${msg}`, "color: #6366f1; font-weight: bold;", "color: #10b981;");
  }, [sim]);

  useEffect(() => {
    const interval = setInterval(() => {
      const buffer = (window as any)._logBuffer;
      if (buffer && buffer.length > 0) {
        const newLogs = [...buffer];
        (window as any)._logBuffer = [];
        
        // --- INFINITE BLACK BOX ---
        (window as any)._fullLogBuffer = (window as any)._fullLogBuffer || [];
        (window as any)._fullLogBuffer.push(...newLogs);

        setAutopilotLogs(prev => {
          const combined = [...prev, ...newLogs];
          // UI Limit: 10,000 logs
          return combined.length > 10000 ? combined.slice(-10000) : combined;
        });
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const clearAutopilotLogs = useCallback(() => {
    (window as any)._logBuffer = [];
    (window as any)._fullLogBuffer = [];
    setAutopilotLogs([]);
  }, []);

  // BroadcastChannel for Editor Sync
  useEffect(() => {
    const channel = new BroadcastChannel('stellar-autopilot-sync');
    
    // Listen for messages from popup editors
    channel.onmessage = (event) => {
      const { type, data } = event.data;
      if (!data.vehicleId) return;
      
      const v = sim.bodies.find(b => b.id === data.vehicleId) as any;
      if (!v) return;

      if (type === 'ping') {
        channel.postMessage({
          type: 'init_state',
          data: {
            vehicleId: v.id,
            vehicleName: v.name,
            isActive: !!v.isAutopilotActive,
            script: v.script || sim.currentScript || '',
            logs: v.autopilotLogs || []
          }
        });
      } else if (type === 'update_script') {
        v.script = data.script;
      } else if (type === 'toggle_autopilot') {
        if (v.isAutopilotActive) {
          sim.stopAutopilot(v.id);
        } else {
          v.script = data.script; // ensure latest script
          sim.startAutopilot(v.script, v.id, (msg) => {
            channel.postMessage({ type: 'new_log', data: { vehicleId: v.id, time: sim.missionTime, msg } });
          });
        }
        channel.postMessage({ type: 'autopilot_state', data: { vehicleId: v.id, isActive: !!v.isAutopilotActive } });
      } else if (type === 'clear_logs_request') {
        v.autopilotLogs = [];
      }
    };

    // Override autopilotLog function to also broadcast to Editor
    const originalLog = sim.autopilotLog;
    sim.autopilotLog = (msg: string) => {
      // Handled in Simulation.ts
    };

    const handleBeforeUnload = () => {
      channel.postMessage({ type: 'close_all_editors' });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      channel.close();
    };
  }, [sim]);

  // Function to download the infinite log
  const downloadFullLog = useCallback(() => {
    const fullLogs = (window as any)._fullLogBuffer || [];
    if (fullLogs.length === 0) return;
    const content = fullLogs.map((l: any) => `[${l.time.toFixed(2)}s] ${l.msg}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telemetry_${new Date().toISOString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // Auto-load from URL
  useEffect(() => {
    if (window.location.hash && window.location.hash.length > 1) {
      try {
        const loadData = (raw: string) => {
          try {
            let jsonStr = raw;
            if (raw.includes('#')) {
              const base64 = raw.split('#')[1];
              jsonStr = decodeURIComponent(escape(atob(base64)));
            } else if (!raw.startsWith('{') && !raw.startsWith('[')) {
              // Assume it's a raw base64 string if not JSON
              jsonStr = decodeURIComponent(escape(atob(raw)));
            }
            const parsed = JSON.parse(jsonStr);
            sim.clear();
            if (Array.isArray(parsed)) {
              sim.bodies = parsed;
            } else if (parsed.bodies) {
              sim.bodies = parsed.bodies;
              if (parsed.script) sim.currentScript = parsed.script;
              if (parsed.camera) {
                sim.camera.x = parsed.camera.x || 0;
                sim.camera.y = parsed.camera.y || 0;
                sim.camera.zoom = parsed.camera.zoom || 1;
                sim.camera.followingId = parsed.camera.followingId || null;
              }
            }
            const v = sim.bodies.find(b => b.type === 'rocket' || b.type === 'heatProtectedRocket');
            if (v) sim.vehicle = v as any;
          } catch (e) {
            console.error("Failed to load scenario", e);
          }
        };

        const initialHash = window.location.hash.substring(1);
        loadData(initialHash);
        setLastAction(() => () => loadData(initialHash));
      } catch (e) {
        console.error("Failed to auto-load scenario from URL", e);
      }
    }
  }, [sim]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore key events when typing in inputs/textareas
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Space → Toggle pause/resume
      if (e.code === 'Space') {
        e.preventDefault();
        sim.paused = !sim.paused;
      }

      // Backspace / Delete → Delete selected body
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedBodyId) {
          e.preventDefault();
          sim.bodies = sim.bodies.filter(b => b.id !== selectedBodyId);
          setSelectedBodyId(null);
        }
      }

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
            const v = sim.vehicle || sim.bodies.find(b => b.type === 'rocket' || b.type === 'heatProtectedRocket');
            if (v) {
               sim.startAutopilot(sim.currentScript, v.id, addAutopilotLog);
            }
          } catch (_) { /* ignore compile errors on launch */ }
        }
        setStreamingMode(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sim, addAutopilotLog, selectedBodyId]);


  const handleSetApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('stellar_api_key', key);
  };

  const onSelectBody = React.useCallback((id: string | null) => {
    setSelectedBodyId(id);
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
            isStreaming={streamingMode}
          />
        </main>

        <Outliner 
          sim={sim} 
          isVisible={showOutliner && !streamingMode} 
          onClose={() => setShowOutliner(false)}
          onSelectBody={onSelectBody}
          selectedBodyId={selectedBodyId}
        />

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
              engineSettings={engineSettings}
              setEngineSettings={setEngineSettings}
              showOutliner={showOutliner}
              setShowOutliner={setShowOutliner}
              streamingMode={streamingMode}
              setStreamingMode={setStreamingMode}
              apiKey={apiKey}
              setApiKey={handleSetApiKey}
              lastAction={lastAction}
              setLastAction={setLastAction}
            />

            <AnimatePresence mode="wait">
              {selectedBodyId ? (
                <Sidebar
                  key="sidebar"
                  sim={sim}
                  selectedBodyId={selectedBodyId}
                  onClose={() => setSelectedBodyId(null)}
                />
              ) : null}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}
