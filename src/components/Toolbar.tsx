import React, { useState, useEffect } from 'react';
import { Simulation } from '../lib/Simulation';
import { MousePointer2, CircleDot, Play, Pause, FastForward, Undo2, MousePointerClick, Sparkles, Plus, Settings, ZoomIn, ZoomOut, Maximize, Ruler, Terminal } from 'lucide-react';
import { ToolMode, AddMode, BodyPreset, VisualSettings, ActivePopUp, EngineSettings } from '../App';
import { AIChat } from './AIChat';
import { catalogue, PlanetarySystem } from '../lib/CatalogueService';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Globe, Sun, Layers, X, Volume2 } from 'lucide-react';

interface ToolbarProps {
  sim: Simulation;
  toolMode: ToolMode;
  setToolMode: (mode: ToolMode) => void;
  addMode: AddMode;
  setAddMode: (mode: AddMode) => void;
  creationPreset: BodyPreset;
  setCreationPreset: (preset: BodyPreset) => void;
  activePopUp: ActivePopUp;
  setActivePopUp: (val: ActivePopUp) => void;
  visualSettings: VisualSettings;
  setVisualSettings: (settings: VisualSettings) => void;
  engineSettings: EngineSettings;
  setEngineSettings: (settings: EngineSettings) => void;
  showOutliner: boolean;
  setShowOutliner: (val: boolean) => void;
  streamingMode: boolean;
  setStreamingMode: (val: boolean) => void;
  apiKey: string;
  setApiKey: (val: string) => void;
  lastAction: (() => void) | null;
  setLastAction: (val: (() => void) | null) => void;
  isMobile: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  sim, toolMode, setToolMode, addMode, setAddMode, creationPreset, setCreationPreset, activePopUp, setActivePopUp, visualSettings, setVisualSettings,
  showOutliner, setShowOutliner, streamingMode, setStreamingMode, apiKey, setApiKey, lastAction, setLastAction,
  engineSettings, setEngineSettings, isMobile
}) => {
  const [paused, setPaused] = useState(sim.paused);
  const [timeScale, setTimeScale] = useState(sim.timeScale);
  const [timeUnit, setTimeUnit] = useState<number>(1);
  const [inputValue, setInputValue] = useState<string>("1");
  const [addMenuTab, setAddMenuTab] = useState<'body' | 'vehicle' | 'system' | 'simulation' | 'exoplanets'>('body');
  const [settingsTab, setSettingsTab] = useState<'visual' | 'audio' | 'streaming' | 'ai' | 'engine'>('visual');
  const [anchors, setAnchors] = useState<Record<string, { left: number, top: number }>>({});
  const [displayZoom, setDisplayZoom] = useState(sim.camera.zoom);
  const dateRef = React.useRef<HTMLSpanElement>(null);
  const [oecSystems, setOecSystems] = useState<PlanetarySystem[]>([]);
  const [loadingOEC, setLoadingOEC] = useState(false);
  const [oecSearch, setOecSearch] = useState('');
  const [oecFilter, setOecFilter] = useState<'all' | 'multi' | 'nearby'>('all');
  const [isJumping, setIsJumping] = useState(false);
  const [jumpProgress, setJumpProgress] = useState(0);
  const [jumpTargetDate, setJumpTargetDate] = useState(sim.getCurrentDate().toISOString().split('T')[0]);
  const [jumpPrecision, setJumpPrecision] = useState<'fast' | 'high' | 'ultra'>('high');
  const [wasmTick, setWasmTick] = useState(0);

  const handleDateClick = (e: React.MouseEvent) => {
    if (isJumping) return;
    togglePopUp('jump', e);
  };

  const handleZoomIn = () => {
    sim.camera.zoom *= 1.5;
    setDisplayZoom(sim.camera.zoom);
  };

  const handleZoomOut = () => {
    sim.camera.zoom /= 1.5;
    setDisplayZoom(sim.camera.zoom);
  };

  const handleResetZoom = () => {
    sim.camera.zoom = 1;
    sim.camera.x = 0;
    sim.camera.y = 0;
    sim.camera.followingId = null;
    setDisplayZoom(1);
  };

  const togglePopUp = (id: Exclude<ActivePopUp, null>, e: React.MouseEvent) => {
    if (activePopUp === id) {
      setActivePopUp(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const isRightSide = rect.left > window.innerWidth / 2;

      setAnchors(prev => ({
        ...prev,
        [id]: {
          left: isRightSide ? rect.right : rect.left,
          center: rect.left + rect.width / 2,
          top: rect.top,
          side: isRightSide ? 'right' : 'left'
        }
      }));

      if (id === 'add') setToolMode('add');
      if (id === 'add' && addMenuTab === 'exoplanets' && oecSystems.length === 0) {
        fetchOEC();
      }
      setActivePopUp(id);
    }
  };

  const fetchOEC = async () => {
    setLoadingOEC(true);
    const data = await catalogue.fetchCatalogue();
    setOecSystems(data);
    setLoadingOEC(false);
  };

  const timeUnits = [
    { label: 'Seconds per second', value: 1 },
    { label: 'Minutes per second', value: 60 },
    { label: 'Hours per second', value: 3600 },
    { label: 'Days per second', value: 86400 },
    { label: 'Years per second', value: 31536000 },
  ];

  const getOptimalTimeUnit = (val: number) => {
    const sorted = [...timeUnits].sort((a, b) => b.value - a.value);
    for (const unit of sorted) {
      if (val / unit.value >= 0.8) return unit.value;
    }
    return 1;
  };

  // Calculate scale legend using 1-2-5 pattern (standard map scale)
  const getScaleInfo = () => {
    const TARGET_PX = 80; // Ideal width for the bar
    const worldRadiiPerPx = 1 / sim.camera.zoom;
    const targetRadii = TARGET_PX * worldRadiiPerPx;
    const targetKm = targetRadii * 6371;

    // Units defined in km
    const units = [
      { label: 'pc', km: 3.086e13 },
      { label: 'ly', km: 9.461e12 },
      { label: 'AU', km: 1.496e8 },
      { label: 'Lunar Distances', km: 384400 },
      { label: 'Earth Radii', km: 6371 },
      { label: 'km', km: 1 },
      { label: 'm', km: 0.001 },
      { label: 'cm', km: 0.00001 },
      { label: 'mm', km: 0.000001 }
    ];

    // Find the best unit
    let unit = units.find(u => targetKm >= u.km) || units[units.length - 1];
    let valueInUnit = targetKm / unit.km;

    // Find "Nice Number" (1, 2, 5) * 10^n
    const exponent = Math.floor(Math.log10(valueInUnit));
    const fraction = valueInUnit / Math.pow(10, exponent);

    let niceFraction: number;
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3.5) niceFraction = 2;
    else if (fraction < 7.5) niceFraction = 5;
    else niceFraction = 10;

    const niceValue = niceFraction * Math.pow(10, exponent);
    const niceKm = niceValue * unit.km;
    const niceWorldRadii = niceKm / 6371;
    const nicePx = niceWorldRadii * sim.camera.zoom;

    // Label formatting: handle plural and small numbers
    const displayValue = parseFloat(niceValue.toPrecision(4));
    let label = `${displayValue} ${unit.label}`;

    // Special handling for clean singulars
    if (displayValue === 1) {
      if (unit.label === 'Earth Radii') label = '1 Earth Radius';
      if (unit.label === 'Lunar Distances') label = '1 Lunar Distance';
    }

    return { label, px: Math.min(128, nicePx) };
  };

  const scale = getScaleInfo();

  useEffect(() => {
    const interval = setInterval(() => {
      if (sim.paused !== paused) setPaused(sim.paused);
      if (Math.abs(sim.camera.zoom - displayZoom) / displayZoom > 0.001) setDisplayZoom(sim.camera.zoom);
      if (sim.timeScale !== timeScale) {
        setTimeScale(sim.timeScale);
        const optimal = getOptimalTimeUnit(sim.timeScale);
        setTimeUnit(optimal);
        setInputValue(parseFloat((sim.timeScale / optimal).toFixed(6)).toString());
      }
      if (dateRef.current) {
        dateRef.current.innerText = sim.getCurrentDate().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      }
    }, 16); // 60fps sync
    return () => clearInterval(interval);
  }, [sim, paused, timeScale, timeUnit, displayZoom]);

  const togglePause = (e: React.PointerEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    sim.paused = !sim.paused;
    setPaused(sim.paused);
  };

  const updateTimeScale = (val: number) => {
    sim.timeScale = val;
    setTimeScale(val);
    const optimal = getOptimalTimeUnit(val);
    setTimeUnit(optimal);
    setInputValue(parseFloat((val / optimal).toFixed(6)).toString());
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      sim.timeScale = val * timeUnit;
      setTimeScale(sim.timeScale);
    }
  };

  const handleUnitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newUnit = Number(e.target.value);
    setTimeUnit(newUnit);
    setInputValue(parseFloat((timeScale / newUnit).toFixed(6)).toString());
  };

  // Button wrapper for consistency
  const DockButton = ({
    active, onClick, onContextMenu, children, title, color = 'blue'
  }: { active?: boolean, onClick?: (e: React.MouseEvent) => void, onContextMenu?: (e: React.MouseEvent) => void, children: React.ReactNode, title?: string, color?: 'blue' | 'purple' | 'red' }) => {
    const colors = {
      blue: active ? 'bg-blue-600 text-white border-blue-500' : 'bg-white/5 text-gray-400 border-white/10 hover:border-white/20 hover:text-white hover:bg-white/10',
      purple: active ? 'bg-purple-600 text-white border-purple-500' : 'bg-white/5 text-purple-400 border-white/10 hover:border-white/20 hover:text-purple-300 hover:bg-purple-900/20',
      red: 'bg-white/5 text-gray-400 border-white/10 hover:border-red-900 hover:text-red-400 hover:bg-red-900/20'
    };

    return (
      <button
        onPointerDown={onClick}
        onContextMenu={onContextMenu}
        className={`w-10 h-10 shrink-0 flex items-center justify-center rounded-lg border transition-all duration-100 outline-none aspect-square touch-none select-none ${colors[color]}`}
        title={title}
      >
        {children}
      </button>
    );
  };

  return (
    <>
      <div className={`fixed bottom-0 left-0 right-0 ${isMobile ? 'h-20' : 'h-16'} bg-[#020508]/95 backdrop-blur-2xl border-t border-white/10 flex items-center justify-between px-3 z-50 shadow-[0_-8px_30px_rgba(0,0,0,0.6)] selection:bg-blue-500/30`}>

        {/* LEFT: SIMULATION CONTROLS */}
        <div className="flex items-center gap-6">
          {/* ACTION TOOLS */}
          <div className="flex items-center gap-1.5">
            <DockButton
              active={toolMode === 'select'}
              onClick={() => { setToolMode('select'); setActivePopUp(null); }}
              title="Analyze & Pan"
            >
              <MousePointer2 size={18} />
            </DockButton>

            <DockButton
              active={showOutliner}
              onClick={() => { setShowOutliner(!showOutliner); setActivePopUp(null); }}
              title="Simulation Outliner (Bodies List)"
            >
              <Layers size={18} />
            </DockButton>



            <DockButton
              active={activePopUp === 'add'}
              onClick={(e) => togglePopUp('add', e)}
              title="Deploy Objects"
            >
              <Plus size={20} />
            </DockButton>

            <DockButton
              color="red"
              onClick={() => { sim.clear(); sim.camera.followingId = null; setLastAction(null); }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (lastAction) {
                  sim.clear();
                  lastAction();
                }
              }}
              title="Clear Simulation (Right-click to reset last system)"
            >
              <Undo2 size={18} />
            </DockButton>
          </div>

          {!isMobile && <div className="w-px h-8 bg-white/10" />}

          {/* TIME CONTROLS */}
          <div className="flex items-center gap-3">
            <DockButton active={!paused} onClick={togglePause} title={paused ? 'Resume Simulation' : 'Pause Simulation'}>
              <div className="pointer-events-none">
                {paused ? <Play size={18} className="fill-current text-green-500" /> : <Pause size={18} className="fill-current text-blue-500" />}
              </div>
            </DockButton>

            <div className="flex items-center gap-2 bg-white/5 rounded-xl px-2 py-1 border border-white/5 h-11 select-none shadow-inner">
              <button
                onClick={() => updateTimeScale(timeScale / 2)}
                className="w-8 h-8 flex items-center justify-center text-[10px] font-bold bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg transition-all"
              >
                ÷2
              </button>

              <div className="flex items-center px-1">
                <input
                  type="number"
                  value={inputValue}
                  onChange={handleInputChange}
                  className="w-16 text-[12px] bg-transparent outline-none text-right font-mono text-blue-400 font-bold"
                />
                <select
                  value={timeUnit}
                  onChange={handleUnitChange}
                  className="text-[10px] bg-transparent text-gray-500 font-bold uppercase outline-none ml-1 cursor-pointer hover:text-gray-300 transition-colors"
                >
                  {timeUnits.map(u => <option key={u.value} value={u.value} className="bg-[#0c1016]">{u.label.split(' ')[0]}</option>)}
                </select>
              </div>

              <button
                onClick={() => updateTimeScale(timeScale * 2)}
                className="w-8 h-8 flex items-center justify-center text-[10px] font-bold bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg transition-all"
              >
                ×2
              </button>
            </div>

            {!isMobile && (
              <div
                onClick={handleDateClick}
                className={`flex flex-col justify-center px-3 h-11 bg-white/5 rounded-xl border border-white/5 shadow-inner select-none cursor-pointer hover:bg-white/10 transition-all relative overflow-hidden group ${isJumping ? 'pointer-events-none' : ''} ${activePopUp === 'jump' ? 'border-blue-500/50 bg-blue-500/10' : ''}`}
              >
                {isJumping && (
                  <div className="absolute left-0 bottom-0 h-full bg-blue-500/20 transition-all duration-75" style={{ width: `${jumpProgress * 100}%` }} />
                )}
                <span className="text-[8px] text-gray-500 uppercase tracking-widest font-bold mb-0.5 group-hover:text-blue-400 transition-colors z-10 relative">
                  {isJumping ? 'Calculating...' : 'Date'}
                </span>
                <span ref={dateRef} className="text-[12px] font-mono font-bold text-white tracking-tight z-10 relative">
                  {sim.getCurrentDate().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: NAVIGATION & SYSTEM */}
          <div className="flex items-center gap-6">
            {/* SCALE & ZOOM POD */}
            <div className="flex items-center gap-6">
              {!isMobile && (
                <div className="flex flex-col items-center justify-center gap-1.5 w-36 shrink-0">
                  <div className="h-1 border-x border-b border-white/30 w-full relative">
                    <div className="absolute inset-x-0 bottom-0 flex justify-center">
                      <div className="h-[2px] bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)]" style={{ width: `${Math.min(100, (scale.px / 128) * 100)}%` }} />
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-gray-400 font-bold uppercase tracking-tight opacity-70 truncate w-full text-center">{scale.label}</span>
                </div>
              )}

              <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/5">
                <button
                  onClick={() => { setToolMode('ruler'); setActivePopUp(null); }}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all group ${toolMode === 'ruler'
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-white/10 text-gray-400 hover:text-white'
                    }`}
                  title="Distance Ruler"
                >
                  <Ruler size={14} className={toolMode === 'ruler' ? '' : 'group-hover:scale-110'} />
                </button>
              </div>

              {!isMobile && (
                <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/5">
                  <button onClick={handleZoomIn} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-all group">
                    <ZoomIn size={16} className="group-hover:scale-110" />
                  </button>
                  <button onClick={handleZoomOut} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-all group">
                    <ZoomOut size={16} className="group-hover:scale-110" />
                  </button>
                  <button onClick={handleResetZoom} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-all group">
                    <Maximize size={16} className="group-hover:rotate-90 transition-transform duration-300" />
                  </button>
                </div>
              )}
            </div>

            {!isMobile && <div className="w-px h-8 bg-white/10" />}

          {/* SYSTEM ACTIONS */}
          <div className="flex items-center gap-1.5">
            <DockButton color="purple" active={activePopUp === 'ai'} onClick={(e) => togglePopUp('ai', e)} title="Astro Copilot">
              <Sparkles size={18} fill={activePopUp === 'ai' ? "currentColor" : "none"} />
            </DockButton>

            <DockButton active={activePopUp === 'settings'} onClick={(e) => togglePopUp('settings', e)} title="Visual Simulation Settings">
              <Settings size={18} />
            </DockButton>
          </div>
        </div>
      </div>

      {/* FLOATING SIBLING POPUPS */}
      <AnimatePresence>
        {activePopUp === 'add' && (
          <motion.div
            style={anchors.add ? {
              left: anchors.add.left,
              bottom: '80px'
            } : undefined}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bg-[#0c1016]/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl flex flex-col z-[100] w-[500px] overflow-hidden will-change-transform"
          >
            {/* Unified Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/5">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[2px] text-gray-500 font-bold">
                <Plus size={13} className="text-blue-400" />
                <span>CONSTRUCTION CORE</span>
              </div>
              <button
                onClick={() => setActivePopUp(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-4">
              <div className="flex bg-white/5 p-1 rounded-lg gap-1 overflow-x-auto no-scrollbar">
                {(['body', 'vehicle', 'system', 'simulation', 'exoplanets'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => {
                      setAddMenuTab(tab);
                      if (tab === 'exoplanets' && oecSystems.length === 0) fetchOEC();
                      if (tab === 'vehicle') {
                        setAddMode('static');
                        sim.creationTemplate.presetType = 'rocket';
                        setCreationPreset({ ...creationPreset, colorType: 'rocket' });
                      }
                    }}
                    className={`flex-1 text-[9px] font-bold uppercase tracking-widest py-1.5 rounded-md transition-all ${addMenuTab === tab
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {addMenuTab === 'vehicle' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        sim.creationTemplate.presetType = 'rocket';
                        setCreationPreset({ ...creationPreset, colorType: 'rocket' });
                        setToolMode('add');
                      }}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${sim.creationTemplate.presetType === 'rocket'
                        ? 'border-blue-500 bg-blue-500/10 text-white'
                        : 'border-white/5 bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white'
                        }`}
                    >
                      <div className="w-4 h-4 bg-white rounded-full" />
                      <span className="text-[11px] font-bold uppercase tracking-wider">Standard Rocket</span>
                    </button>
                    <button
                      onClick={() => {
                        sim.creationTemplate.presetType = 'heatProtectedRocket';
                        setCreationPreset({ ...creationPreset, colorType: 'heatProtectedRocket' });
                        setToolMode('add');
                      }}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${sim.creationTemplate.presetType === 'heatProtectedRocket'
                        ? 'border-blue-500 bg-blue-500/10 text-white'
                        : 'border-white/5 bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white'
                        }`}
                    >
                      <div className="w-4 h-4 bg-orange-500 rounded-full" />
                      <span className="text-[11px] font-bold uppercase tracking-wider">Heat-Protected Rocket</span>
                    </button>
                  </div>
                  <div className="pt-2 border-t border-white/10 space-y-1">
                    {[
                      { id: 'orbit', label: 'Orbital Placement', icon: <MousePointerClick size={12} /> },
                      { id: 'static', label: 'Static Deployment', icon: <CircleDot size={12} /> },
                      { id: 'velocity', label: 'Kinetic Launch', icon: <FastForward size={12} /> }
                    ].map(m => (
                      <button
                        key={m.id}
                        onClick={() => { setAddMode(m.id as AddMode); setToolMode('add'); setActivePopUp(null); }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[10px] uppercase font-bold tracking-wider transition-all ${addMode === m.id ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-white/5 hover:text-white'
                          }`}
                      >
                        <span className="flex items-center gap-2">{m.icon} {m.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {addMenuTab === 'body' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    {(['star', 'planet', 'moon', 'comet', 'blackhole'] as const).map(p => {
                      const tempSim = new Simulation();
                      tempSim.creationTemplate.presetType = p;
                      const meta = tempSim.getBodyMetadataFromPreset();
                      return (
                        <button
                          key={p}
                          onClick={() => {
                            sim.creationTemplate.presetType = p;
                            setCreationPreset({ ...creationPreset, colorType: p });
                            if (p === 'star' || p === 'blackhole') setAddMode('static');
                            else if (p === 'comet') setAddMode('velocity');
                            else setAddMode('orbit');
                          }}
                          className={`flex flex-col items-center gap-2 p-2 rounded-lg border transition-all ${sim.creationTemplate.presetType === p
                            ? 'border-blue-500 bg-blue-500/10 text-white'
                            : 'border-white/5 bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white'
                            }`}
                        >
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p === 'blackhole' ? 'black' : meta.color, border: '1px solid white' }} />
                          <span className="text-[10px] font-bold uppercase tracking-wider">{p}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="pt-2 border-t border-white/10 space-y-1">
                    {[
                      { id: 'orbit', label: 'Orbital Placement', icon: <MousePointerClick size={12} /> },
                      { id: 'static', label: 'Static Deployment', icon: <CircleDot size={12} /> },
                      { id: 'velocity', label: 'Kinetic Launch', icon: <FastForward size={12} /> }
                    ].map(m => (
                      <button
                        key={m.id}
                        onClick={() => { setAddMode(m.id as AddMode); setToolMode('add'); setActivePopUp(null); }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[10px] uppercase font-bold tracking-wider transition-all ${addMode === m.id ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-white/5 hover:text-white'
                          }`}
                      >
                        <span className="flex items-center gap-2">{m.icon} {m.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {addMenuTab === 'system' && (
                <div className="space-y-1">
                  {[
                    { label: 'Solar System (Basic)', action: () => sim.loadSolarSystem() },
                    { label: 'Solar System (1:1 Scale)', action: () => sim.loadRealScaleSolarSystem() },
                    { label: 'Trisolar System', action: () => sim.loadTrisolarSystem() },
                    { label: 'The Figure-8', action: () => sim.loadFigure8() },
                    { label: 'Asteroid Belt', action: () => sim.loadAsteroidBelt() },
                    { label: 'Black Hole Binary', action: () => sim.loadBlackHoleSystem() }
                  ].map(sys => (
                    <button
                      key={sys.label}
                      onClick={() => {
                        sys.action();
                        setToolMode('select');
                        setActivePopUp(null);
                        setLastAction(() => sys.action);
                      }}
                      className="w-full text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                    >
                      {sys.label}
                    </button>
                  ))}
                </div>
              )}

              {addMenuTab === 'simulation' && (
                <div className="space-y-1">
                  {[
                    { label: 'Meteor Shower', action: () => sim.loadMeteorShower() },
                    { label: 'Auto-Orbit Mission', action: () => sim.loadOrbitMission() },
                    { label: 'Artemis 2 Mission', action: () => sim.loadArtemis2Mission() },
                    { label: 'Rocket Fleet (12x)', action: () => (sim as any).loadFleetLaunch(sim.currentScript) },
                    { label: 'Rocket on Earth', action: () => sim.loadRocketOnEarth() },
                    { label: 'Deep Impact (Crash Test)', action: () => (sim as any).loadDeepImpactScenario() },
                    { label: 'Black Hole Devour', action: () => sim.loadBlackHoleDevour(), red: true }
                  ].map(scenario => (
                    <button
                      key={scenario.label}
                      onClick={() => {
                        scenario.action();
                        setToolMode('select');
                        setActivePopUp(null);
                        setLastAction(() => scenario.action);
                        if (sim.currentScript) {
                          // Start the script in background without showing the editor
                          sim.startAutopilot(sim.currentScript, (sim.vehicle || sim.bodies.find(b => b.type === 'rocket' || b.type === 'heatProtectedRocket'))?.id, (msg) => {
                             // Broadcast to logs if needed
                             (window as any)._logBuffer = (window as any)._logBuffer || [];
                             (window as any)._logBuffer.push({ time: sim.missionTime, msg });
                          });
                        }
                      }}
                      className={`w-full text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${scenario.red ? 'text-red-400 hover:bg-red-400/10' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                    >
                      {scenario.label}
                    </button>
                  ))}
                </div>
              )}

              {addMenuTab === 'exoplanets' && (
                <div className="space-y-4 flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      type="text"
                      placeholder="Search OEC (e.g. TRAPPIST, Kepler)..."
                      value={oecSearch}
                      onChange={(e) => setOecSearch(e.target.value)}
                      className="w-full bg-black/40 border border-white/5 rounded-xl py-2 pl-9 pr-4 text-[11px] text-white outline-none focus:border-blue-500/50"
                    />
                  </div>

                  <div className="flex gap-1">
                    {(['all', 'multi', 'nearby'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setOecFilter(f)}
                        className={`flex-1 py-1 rounded text-[8px] font-bold uppercase tracking-widest transition-all ${oecFilter === f ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'bg-white/5 text-gray-500'}`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>

                  <div className="flex-1 overflow-y-auto no-scrollbar space-y-2 pr-1" style={{ maxHeight: '400px' }}>
                    {loadingOEC ? (
                      <div className="py-20 flex flex-col items-center justify-center gap-3 opacity-50">
                        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <div className="text-[9px] font-bold tracking-[2px] uppercase">Retrieving Catalogue...</div>
                      </div>
                    ) : (
                      oecSystems
                        .filter(s => {
                          if (oecSearch) return s.name.toLowerCase().includes(oecSearch.toLowerCase());
                          if (oecFilter === 'multi') return s.planets.length > 3;
                          if (oecFilter === 'nearby') return s.planets[0].distance < 20 && s.planets[0].distance > 0;
                          return true;
                        })
                        .slice(0, 100)
                        .map(sys => (
                          <button
                            key={sys.name}
                            onClick={() => {
                              sim.loadOECSystem(sys);
                              setActivePopUp(null);
                              setLastAction(() => () => sim.loadOECSystem(sys));
                            }}
                            className="w-full flex items-center justify-between bg-black/40 hover:bg-blue-900/10 border border-white/5 hover:border-blue-500/30 p-3 rounded-xl transition-all group"
                          >
                            <div className="text-left flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition-all">
                                {sys.planets.length > 1 ? <Layers size={14} /> : <Globe size={14} />}
                              </div>
                              <div>
                                <div className="text-[11px] font-bold text-white group-hover:text-blue-400">{sys.name}</div>
                                <div className="text-[9px] text-gray-500 mt-0.5">
                                  {sys.planets.length} Planets • {sys.star.mass.toFixed(2)} M☉ • {sys.planets[0].radius > 0 ? (sys.planets[0].radius * 11.2).toFixed(1) : '?'} R⊕ • {sys.planets[0].mass > 0 ? (sys.planets[0].mass * 317.8).toFixed(1) : '?'} M⊕
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[8px] text-blue-500 font-bold tracking-widest group-hover:translate-x-1 transition-transform">DEPLOY →</div>
                              {sys.planets[0].distance > 0 && (
                                <div className="text-[7px] text-gray-600 mt-1">{sys.planets[0].distance.toFixed(1)} pc</div>
                              )}
                            </div>
                          </button>
                        ))
                    )}
                  </div>

                  <div className="p-2 bg-blue-500/5 rounded-xl border border-blue-500/10">
                    <div className="text-[8px] text-blue-400/80 uppercase font-bold tracking-[2px] flex items-center gap-2">
                      <Sun size={10} />
                      Scientific Metadata
                    </div>
                    <div className="text-[8px] text-gray-500 mt-1 leading-relaxed">
                      Showing {oecSystems.length} systems from OEC. Parameters are derived from RV/Transit data.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {activePopUp === 'jump' && (
          <motion.div
            style={{
              left: anchors['jump']?.left,
              bottom: '80px',
              transform: anchors['jump']?.side === 'right' ? 'translateX(-100%)' : 'none'
            }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className={`fixed bg-[#0c1016]/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl z-[60] flex flex-col w-72 overflow-hidden will-change-transform`}
          >
            {/* Unified Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/5">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[2px] text-gray-500 font-bold">
                <FastForward size={13} className="text-blue-400" />
                <span>TEMPORAL JUMP</span>
              </div>
              <button
                onClick={() => setActivePopUp(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-4">
              <div className="space-y-1.5">
                <label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest px-1">Target Date</label>
                <input
                  type="date"
                  value={jumpTargetDate}
                  onChange={(e) => setJumpTargetDate(e.target.value)}
                  className="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-2.5 text-[12px] text-white outline-none focus:border-blue-500/50 font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-bold text-gray-500 uppercase tracking-widest px-1">Calculation Precision</label>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { id: 'fast', label: 'Fast', desc: '1h steps' },
                    { id: 'high', label: 'High', desc: '15m steps' },
                    { id: 'ultra', label: 'Ultra', desc: '1m steps' }
                  ].map(p => (
                    <button
                      key={p.id}
                      onClick={() => setJumpPrecision(p.id as any)}
                      className={`flex flex-col items-center gap-0.5 py-2 rounded-xl border transition-all ${jumpPrecision === p.id ? 'bg-blue-600/20 border-blue-500/50 text-blue-400' : 'bg-white/5 border-white/10 text-gray-500 hover:text-gray-300'}`}
                    >
                      <span className="text-[9px] font-bold uppercase">{p.label}</span>
                      <span className="text-[7px] opacity-60 font-mono uppercase">{p.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => {
                  const d = new Date(jumpTargetDate);
                  if (!isNaN(d.getTime())) {
                    setIsJumping(true);
                    setJumpProgress(0);
                    sim.jumpToDateAsync(d, jumpPrecision, (p) => setJumpProgress(p), () => {
                      setIsJumping(false);
                    });
                    setActivePopUp(null);
                  }
                }}
                disabled={isJumping}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl py-3 text-[10px] font-bold uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(37,99,235,0.4)] mt-2"
              >
                Initiate Warp
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activePopUp === 'settings' && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
            {/* Dark overlay backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActivePopUp(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto"
            />

            {/* Modal Box */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative bg-[#0c1016]/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl w-[800px] min-h-[600px] flex flex-col pointer-events-auto overflow-hidden will-change-transform"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/5">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[2px] text-gray-500 font-bold">
                  <Settings size={13} className="text-blue-400" />
                  <span>SYSTEM SETTINGS</span>
                </div>
                <button
                  onClick={() => setActivePopUp(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div className="flex flex-1 min-h-0">
                {/* Left Sidebar Tabs */}
                <div className="w-[200px] border-r border-white/10 bg-black/20 p-2 flex flex-col gap-1">
                  {[
                    { id: 'visual', label: 'Visuals', icon: <Layers size={14} /> },
                    { id: 'audio', label: 'Audio', icon: <Volume2 size={14} /> },
                    { id: 'streaming', label: 'Streaming', icon: <Globe size={14} /> },
                    { id: 'ai', label: 'Astro Copilot', icon: <Sparkles size={14} /> },
                    { id: 'engine', label: 'Engine Core', icon: <Settings size={14} /> }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setSettingsTab(tab.id as any)}
                      className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider px-3 py-3 rounded-lg transition-all text-left ${settingsTab === tab.id
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-sm'
                        : 'text-gray-500 hover:text-gray-300 hover:bg-white/5 border border-transparent'
                        }`}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Right Content Area */}
                <div className="flex-1 p-6 overflow-y-auto">
                  {settingsTab === 'visual' && (
                    <div className="flex flex-col gap-2">
                      <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Graphics Configuration</div>
                      {[
                        { id: 'warpEnabled', label: 'Space Warp Grid' },
                        { id: 'gridEnabled', label: 'Coordinate Grid' },
                        { id: 'starsEnabled', label: 'Background Stars' },
                        { id: 'trailsEnabled', label: 'Orbital History Trails' }
                      ].map((opt) => (
                        <label key={opt.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 cursor-pointer transition-colors group">
                          <span className="text-[11px] uppercase tracking-wide text-gray-300 group-hover:text-white font-medium">{opt.label}</span>
                          <input
                            type="checkbox"
                            checked={(visualSettings as any)[opt.id]}
                            onChange={() => setVisualSettings({ ...visualSettings, [opt.id]: !(visualSettings as any)[opt.id] })}
                            className="w-4 h-4 rounded border-white/10 bg-black/50 text-blue-500 focus:ring-0"
                          />
                        </label>
                      ))}
                    </div>
                  )}

                  {settingsTab === 'audio' && (
                    <div className="flex flex-col gap-2">
                      <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Audio & Voice Configuration</div>
                      {[
                        { id: 'ttsEnabled', label: 'Master TTS Voice Feedback', desc: 'Enable or disable autopilot vocal notifications.' },
                        { id: 'ttsAdaptiveRate', label: 'Adaptive TTS Rate', desc: 'Sync voice speed with simulation time scale.' }
                      ].map((opt) => (
                        <label key={opt.id} className="flex flex-col gap-1 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 cursor-pointer transition-colors group">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] uppercase tracking-wide text-gray-300 group-hover:text-white font-medium">{opt.label}</span>
                            <input
                              type="checkbox"
                              checked={(visualSettings as any)[opt.id]}
                              onChange={() => setVisualSettings({ ...visualSettings, [opt.id]: !(visualSettings as any)[opt.id] })}
                              className="w-4 h-4 rounded border-white/10 bg-black/50 text-blue-500 focus:ring-0"
                            />
                          </div>
                          <span className="text-[9px] text-gray-500 leading-tight">{opt.desc}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {settingsTab === 'streaming' && (
                    <div className="flex flex-col gap-2">
                      <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Cinematic Broadcasting</div>
                      <p className="text-gray-400 text-xs mb-2 leading-relaxed">
                        Enable Streaming Mode to activate the cinematic camera, telemetry HUD, and hide editing UI. Useful for recording or live broadcasting.
                      </p>
                      <button
                        onClick={() => setStreamingMode(!streamingMode)}
                        className={`w-full flex items-center justify-between p-4 rounded-lg border transition-all ${streamingMode
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                          : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
                          }`}
                      >
                        <span className="text-[11px] uppercase tracking-wide font-bold">
                          {streamingMode ? '● LIVE BROADCASTING ACTIVE' : 'Enable Streaming Mode'}
                        </span>
                        <span className="text-[10px] bg-black/30 px-2 py-1 rounded text-white/50 font-mono font-medium">Ctrl+Shift+S</span>
                      </button>
                    </div>
                  )}

                  {settingsTab === 'ai' && (
                    <div className="flex flex-col gap-2">
                      <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">Astro Copilot</div>
                      <p className="text-gray-400 text-xs mb-3 leading-relaxed">
                        Configure the Gemini AI connection to enable automated code generation and script analysis for your orbital mechanics.
                      </p>
                      <label className="flex flex-col gap-2">
                        <span className="text-[10px] text-gray-300 uppercase tracking-widest font-semibold">Gemini API Key</span>
                        <input type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder="Paste your Gemini key here..."
                          className="bg-black/40 border border-white/10 rounded-lg px-3 py-3 text-sm text-purple-400 outline-none focus:border-purple-500 focus:bg-black/60 font-mono transition-colors"
                        />
                        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-[10px] text-purple-500/70 hover:text-purple-400 underline transition-colors self-start mt-1">Get a free key at Google AI Studio</a>
                      </label>
                    </div>
                  )}
                  {settingsTab === 'engine' && (
                    <div className="flex flex-col gap-4">
                      
                      <div className="flex flex-col gap-3 pt-2 border-t border-white/5">
                        <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Physics Engine</div>
                        
                        {/* Mode Selector */}
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] text-gray-400 uppercase tracking-widest px-1">Calculation Mode</span>
                          <select 
                            value={engineSettings.physicsMode}
                            onChange={(e) => {
                              const mode = e.target.value as any;
                              const updates: Partial<EngineSettings> = { physicsMode: mode };
                              if (mode === 'optimal') {
                                sim.physicsPrecision = 0.01;
                                sim.maxSubsteps = 200;
                              }
                              setEngineSettings({ ...engineSettings, ...updates });
                            }}
                            className="bg-black/40 border border-white/5 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-blue-500/50 transition-all font-mono"
                          >
                            <option value="optimal">Optimal (Balanced)</option>
                            <option value="preset">Preset (Power Selection)</option>
                            <option value="custom">Custom (Scientific Manual)</option>
                          </select>
                        </div>

                        {/* Preset Slider (Visible in Preset mode) */}
                        {engineSettings.physicsMode === 'preset' && (
                          <div className="flex flex-col gap-2 p-3 rounded-xl border border-white/5 bg-black/40">
                            <div className="flex justify-between text-[9px] text-gray-500 uppercase tracking-tight font-bold">
                              <span>Max Speed</span>
                              <span>Ultra Precision</span>
                            </div>
                            <input 
                              type="range"
                              min="0"
                              max="4"
                              step="1"
                              value={engineSettings.physicsPreset}
                              onChange={(e) => {
                                const val = parseInt(e.target.value);
                                setEngineSettings({ ...engineSettings, physicsPreset: val });
                                // Apply preset values to simulation
                                const presets = [
                                  { p: 0.1, s: 50 },  // Speed
                                  { p: 0.05, s: 100 },
                                  { p: 0.01, s: 200 }, // Default
                                  { p: 0.005, s: 500 },
                                  { p: 0.001, s: 1000 } // Precision
                                ];
                                sim.physicsPrecision = presets[val].p;
                                sim.maxSubsteps = presets[val].s;
                              }}
                              className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
                            />
                            <div className="flex justify-between text-[8px] text-blue-400 font-mono">
                              <span>{engineSettings.physicsPreset === 0 ? 'BOOST' : ''}</span>
                              <span>{engineSettings.physicsPreset === 2 ? 'BALANCED' : ''}</span>
                              <span>{engineSettings.physicsPreset === 4 ? 'SCIENTIFIC' : ''}</span>
                            </div>
                          </div>
                        )}

                        {/* Custom Inputs (Visible in Custom mode) */}
                        {engineSettings.physicsMode === 'custom' && (
                          <div className="grid grid-cols-2 gap-2 p-3 rounded-xl border border-white/5 bg-black/40">
                            <div className="flex flex-col gap-1">
                              <span className="text-[9px] text-gray-500 uppercase font-bold tracking-tight">Precision (Step)</span>
                              <input 
                                type="number"
                                step="0.001"
                                defaultValue={sim.physicsPrecision}
                                onBlur={(e) => {
                                  const val = parseFloat(e.target.value);
                                  if (!isNaN(val) && val > 0) {
                                    sim.physicsPrecision = val;
                                    setWasmTick(t => t + 1);
                                  }
                                }}
                                className="bg-black/20 border border-white/5 rounded-lg px-2 py-1.5 text-xs text-blue-400 font-mono outline-none focus:border-blue-500/50"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-[9px] text-gray-500 uppercase font-bold tracking-tight">Max Substeps</span>
                              <input 
                                type="number"
                                defaultValue={sim.maxSubsteps}
                                onBlur={(e) => {
                                  const val = parseInt(e.target.value);
                                  if (!isNaN(val) && val > 0) {
                                    sim.maxSubsteps = val;
                                    setWasmTick(t => t + 1);
                                  }
                                }}
                                className="bg-black/20 border border-white/5 rounded-lg px-2 py-1.5 text-xs text-blue-400 font-mono outline-none focus:border-blue-500/50"
                              />
                            </div>
                          </div>
                        )}

                        {/* Common Global Constant */}
                        <label className="flex flex-col gap-1 p-3 rounded-xl border border-white/5 bg-black/40">
                          <span className="text-[9px] text-gray-500 uppercase font-bold tracking-tight">Gravitational Constant (G)</span>
                          <input type="number"
                            defaultValue={sim.G}
                            step="any"
                            onBlur={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) sim.G = val;
                            }}
                            className="bg-black/20 border border-white/5 rounded-lg px-2 py-2 text-xs text-blue-400 font-mono outline-none focus:border-blue-500/50 transition-all"
                          />
                        </label>
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Simulation State</div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(JSON.stringify(sim.bodies.map(b => ({ ...b, trail: [] }))));
                              alert('Scenario JSON exported to clipboard!');
                            }}
                            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-[10px] uppercase tracking-wider py-2 rounded transition-colors"
                          >Export JSON</button>
                          <button
                            onClick={() => {
                              const exportData = {
                                bodies: sim.bodies.map(b => ({ ...b, trail: [] })),
                                script: sim.currentScript,
                                camera: {
                                  x: sim.camera.x,
                                  y: sim.camera.y,
                                  zoom: sim.camera.zoom,
                                  followingId: sim.camera.followingId
                                }
                              };
                              const json = JSON.stringify(exportData);
                              const base64 = btoa(unescape(encodeURIComponent(json)));
                              window.history.replaceState(null, '', '#' + base64);
                              navigator.clipboard.writeText(window.location.href);
                              alert('Shareable URL generated and copied to clipboard!');
                            }}
                            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-[10px] uppercase tracking-wider py-2 rounded transition-colors"
                          >Export URL</button>
                          <button
                            onClick={() => {
                              const data = prompt('Paste scenario data or URL:');
                              if (data) {
                                const loadData = (raw: string) => {
                                  try {
                                    let jsonStr = raw;
                                    if (raw.includes('#')) {
                                      const base64 = raw.split('#')[1];
                                      jsonStr = decodeURIComponent(escape(atob(base64)));
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
                                    alert('Invalid scenario data');
                                  }
                                };
                                loadData(data);
                                setLastAction(() => () => loadData(data));
                              }
                            }}
                            className="flex-1 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 text-[10px] uppercase tracking-wider py-2 rounded transition-colors"
                          >Import</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AIChat
        sim={sim}
        show={activePopUp === 'ai'}
        onClose={() => setActivePopUp(null)}
        anchorRect={anchors.ai as any}
        apiKey={apiKey}
        onSetApiKey={setApiKey}
        onInjectScript={(script, targetId) => {
          sim.currentScript = script;
          const finalTargetId = targetId || (sim.vehicle || sim.bodies.find(b => b.type === 'rocket' || b.type === 'heatProtectedRocket'))?.id;
          
          sim.startAutopilot(script, finalTargetId, (msg) => {
             (window as any)._logBuffer = (window as any)._logBuffer || [];
             (window as any)._logBuffer.push({ time: sim.missionTime, msg });
          });
        }}
      />
    </>
  );
};
