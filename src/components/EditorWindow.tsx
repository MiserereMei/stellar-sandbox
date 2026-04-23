import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Play, Square } from 'lucide-react';

export default function EditorWindow() {
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [vehicleName, setVehicleName] = useState<string>('');
  const [script, setScript] = useState<string>('');
  const [logs, setLogs] = useState<{ time: number, msg: string }[]>([]);
  const [isActive, setIsActive] = useState<boolean>(false);
  const [isLogVisible, setIsLogVisible] = useState(true);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('editor');
    if (id) setVehicleId(id);

    const channel = new BroadcastChannel('stellar-autopilot-sync');
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const { type, data } = event.data;
      
      if (type === 'close_all_editors') {
        window.close();
        return;
      }

      if (!data || data.vehicleId !== id) return;

      if (type === 'init_state') {
        setScript(data.script || '');
        setLogs(data.logs || []);
        setIsActive(!!data.isActive);
        if (data.vehicleName) {
          setVehicleName(data.vehicleName);
          document.title = `Autopilot Editor: ${data.vehicleName}`;
        } else {
          document.title = `Autopilot Editor: ${id}`;
        }
      } else if (type === 'new_log') {
        setLogs(prev => [...prev, { time: data.time, msg: data.msg }]);
      } else if (type === 'clear_logs') {
        setLogs([]);
      } else if (type === 'sync_script_from_main') {
        setScript(data.script);
      } else if (type === 'autopilot_state') {
        setIsActive(!!data.isActive);
      }
    };

    // Ping main window to send initial state
    channel.postMessage({ type: 'ping', data: { vehicleId: id } });

    return () => {
      channel.close();
    };
  }, []);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'auto' });
    }
  }, [logs]);

  const handleScriptChange = (value: string | undefined) => {
    const val = value || '';
    setScript(val);
    if (channelRef.current && vehicleId) {
      channelRef.current.postMessage({
        type: 'update_script',
        data: { vehicleId, script: val }
      });
    }
  };

  const handleEditorDidMount = (editor: any, monaco: any) => {
    // Add TypeScript definitions for `fc` object for IntelliSense
    monaco.languages.typescript.javascriptDefaults.addExtraLib(`
      declare namespace fc {
        function getAltitude(): number;
        function getRelativeSpeed(): number;
        function getRadialSpeed(): number;
        function getTangentialSpeed(): number;
        function getVerticalSpeed(): number;
        function getHorizontalSpeed(): number;
        function getRotation(): number;
        function getAngularVelocity(): number;
        function getThrust(): number;
        function getRotate(): number;
        function setThrust(v: number): void;
        function setRotate(v: number): void;
        function igniteBooster(thrust: number, burnTime: number, onBurnout?: () => void): void;
        function log(message: string): void;
        function speak(text: string, options?: any): void;
        function on(event: string, callback: Function): void;

        namespace essentials {
          function setPitch(deg: number): void;
          function setLaunchTime(s: number): void;
        }
        
        namespace camera {
          function setZoom(v: number): void;
          function setOffset(x: number, y: number): void;
          function setShake(v: number): void;
        }

        function getDominantBody(): any;
        function getBodyById(id: string): any;
        function getBodies(): any[];
        function getVehicle(): any;
      }
    `, 'filename/fc.d.ts');
  };

  if (!vehicleId) {
    return <div className="p-4 text-white">No vehicle ID provided.</div>;
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-[#11141b] text-white overflow-hidden font-sans">
      <div className={`flex-1 transition-all duration-300 relative ${isLogVisible ? 'h-[70%]' : 'h-[calc(100%-44px)]'}`}>
        <Editor
          height="100%"
          defaultLanguage="javascript"
          theme="vs-dark"
          value={script}
          onChange={handleScriptChange}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: 'JetBrains Mono, Fira Code, monospace',
            padding: { top: 16 },
            scrollBeyondLastLine: false,
          }}
        />
      </div>

      <div className={`border-t border-white/10 bg-black/60 flex flex-col transition-all duration-300 ${isLogVisible ? 'h-[30%] min-h-[150px]' : 'h-[44px] overflow-hidden'}`}>
        <div 
          className="px-4 py-2 bg-[#1a1d24]/80 border-b border-white/5 flex justify-between items-center cursor-pointer hover:bg-white/5 transition-colors"
          onClick={() => setIsLogVisible(!isLogVisible)}
        >
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">
              Telemetry Log {logs.length > 0 && `(${logs.length})`}
            </span>
            <span className="text-gray-500 text-[10px]">{isLogVisible ? '▼' : '▲'}</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={(e) => {
                e.stopPropagation();
                channelRef.current?.postMessage({ type: 'toggle_autopilot', data: { vehicleId, script } });
              }}
              title={isActive ? "Disengage Autopilot" : "Engage Autopilot"}
              className={`px-4 py-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider rounded-md transition-colors ${isActive ? 'bg-red-500/20 text-red-400 hover:bg-red-500/40 border border-red-500/30' : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/40 border border-emerald-500/30'}`}
            >
              {isActive ? (
                <>
                  <Square size={11} fill="currentColor" /> Stop
                </>
              ) : (
                <>
                  <Play size={12} fill="currentColor" /> Start
                </>
              )}
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setLogs([]);
                channelRef.current?.postMessage({ type: 'clear_logs_request', data: { vehicleId } });
              }}
              className="text-[10px] text-gray-500 hover:text-red-400 transition-colors px-2 py-0.5 rounded hover:bg-red-400/10 border border-transparent hover:border-red-400/30"
            >
              Clear Logs
            </button>
          </div>
        </div>
        
        {isLogVisible && (
          <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed scrollbar-thin scrollbar-thumb-white/10">
            {logs.length === 0 && <div className="text-slate-700 italic">Awaiting telemetry...</div>}
            {logs.map((log, i) => (
              <div key={i} className="flex gap-3 border-b border-white/5 pb-1 mb-1 last:border-0 last:mb-0">
                <span className="text-sky-500/60 shrink-0">[{log.time.toFixed(1)}s]</span>
                <span className={log.msg.includes('Error') ? 'text-red-400' : 'text-slate-300'}>{log.msg}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}
