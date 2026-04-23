import React, { useEffect, useState } from 'react';
import { Simulation, Body } from '../lib/Simulation';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, Trash2, X } from 'lucide-react';

interface SidebarProps {
  sim: Simulation;
  selectedBodyId: string | null;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ sim, selectedBodyId, onClose }) => {
  const [body, setBody] = useState<Body | null>(null);
  const [massUnit, setMassUnit] = useState<string>('Solar Masses');
  const [radiusUnit, setRadiusUnit] = useState<string>('Solar Radii');
  const [speedUnit, setSpeedUnit] = useState<string>('km/s');
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const massUnits: Record<string, number> = {
    'Kilograms': 1.6744e-25,      
    'Metric Tons': 1.6744e-22,
    'Moon Masses': 0.0123,       
    'Earth Masses': 1,        
    'Solar Masses': 333000,     
  };

  const radiusUnits: Record<string, number> = {
    'Meters': 1.5696e-7,        
    'Kilometers': 1.5696e-4,
    'Earth Radii': 1,         
    'Solar Radii': 109.1,         
    'AU (Astro Units)': 23481,        
    'Lunar Distance': 60.32,  
    'Light Years': 1.485e9, // 9.461e12 km / 6371 km
  };

  const speedUnits: Record<string, number> = {
    'km/h': 1 / 36000000, 
    'km/s': 0.0001,      
    'Light Speed (c)': 80,             
  };

  const getOptimalUnit = (val: number, units: Record<string, number>) => {
    const entries = Object.entries(units).sort((a,b) => a[1] - b[1]);
    let best = entries[0][0];
    for(const [name, scale] of entries) {
      if (val / scale >= 1) best = name;
      else break;
    }
    return best;
  };

  // Sync state occasionally or on selection
  useEffect(() => {
    if (!selectedBodyId) {
      setBody(null);
      return;
    }
    
    // Set optimal units once on initial selection
    const initialBody = sim.bodies.find(b => b.id === selectedBodyId);
    if (initialBody) {
      setMassUnit(getOptimalUnit(initialBody.mass, massUnits));
      setRadiusUnit(getOptimalUnit(initialBody.radius, radiusUnits));
      const speed = Math.sqrt(initialBody.velocity.x**2 + initialBody.velocity.y**2);
      setSpeedUnit(getOptimalUnit(speed, speedUnits));
    }

    // Poll for updates so velocity/pos show changes
    const interval = setInterval(() => {
       if (focusedField) return; // Don't overwrite while user is typing
       
       const b = sim.bodies.find(b => b.id === selectedBodyId);
       if (b) {
         setBody({ ...b }); 
       } else {
         setBody(null);
       }
    }, 100); 

    return () => clearInterval(interval);
  }, [selectedBodyId, sim]);

  const updateBody = (updates: Partial<Body>) => {
    const actualBody = sim.bodies.find(b => b.id === body!.id);
    if (!actualBody) return;
    Object.assign(actualBody, updates);
    setBody({ ...actualBody });
  };

  return (
    <AnimatePresence>
      {body && (
        <motion.aside 
          initial={{ x: 340, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 340, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="fixed top-4 right-4 bottom-20 w-[320px] bg-[#11141b]/25 backdrop-blur-2xl border border-white/10 flex flex-col overflow-hidden rounded-2xl shadow-2xl z-[60] p-6 gap-8 will-change-transform"
        >
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
          <section className="flex flex-col gap-8 h-full overflow-y-auto pr-1">
        <section>
          <div className="text-[10px] uppercase tracking-[2px] text-gray-500 mb-4 flex flex-col gap-1">
            <span className="font-bold">SYSTEM DATA // {body.id.slice(0, 8)}</span>
            <span className="text-blue-500 font-extrabold text-[12px]">{getBodyType(sim, body).toUpperCase()}</span>
          </div>
          
          <div className="space-y-5">
            {((body as any).type === 'rocket' || (body as any).type === 'heatProtectedRocket') && (
              <div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-xl space-y-4">
                <span className="text-[10px] uppercase tracking-wider text-blue-400 font-bold">Vehicle Settings</span>
                
                <button 
                  onClick={() => {
                    window.open(`/?editor=${body.id}`, `Editor_${body.id}`, 'width=800,height=600,left=200,top=100');
                  }}
                  className="w-full py-2 flex items-center justify-center rounded-xl text-[10px] uppercase font-bold tracking-widest transition-colors border bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50"
                >
                  Edit Autopilot
                </button>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Thrust Power</span>
                  <div className="flex items-center w-full bg-black/40 rounded-xl border border-white/5 overflow-hidden">
                    <button 
                      onClick={() => {
                        const val = Math.max(1e-20, ((body as any).thrustPower || 0) / 2);
                        updateBody({ thrustPower: val } as any);
                      }} 
                      className="px-2 py-2 text-[10px] font-bold text-gray-500 hover:text-white hover:bg-white/5 transition-colors border-r border-white/5 shrink-0"
                    >/2</button>
                    <input 
                      type="text"
                      value={focusedField === 'thrust' ? undefined : ((body as any).thrustPower === 0 ? "0" : ((body as any).thrustPower || 0).toExponential(2).replace('e+0', ''))}
                      onFocus={() => setFocusedField('thrust')}
                      onBlur={() => setFocusedField(null)}
                      onChange={e => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) { 
                           updateBody({ thrustPower: val } as any);
                        }
                      }}
                      className="font-mono text-[12px] text-white bg-transparent flex-1 text-right outline-none px-2 py-2"
                    />
                    <button 
                      onClick={() => {
                        const val = ((body as any).thrustPower || 0) * 2;
                        updateBody({ thrustPower: val } as any);
                      }} 
                      className="px-2 py-2 text-[10px] font-bold text-gray-500 hover:text-white hover:bg-white/5 transition-colors border-l border-white/5 shrink-0"
                    >x2</button>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Max Integrity Energy</span>
                  <input 
                    type="number" 
                    value={focusedField === 'integrity' ? undefined : ((body as any).maxKineticEnergy || 0).toFixed(0)} 
                    onFocus={() => setFocusedField('integrity')}
                    onBlur={() => setFocusedField(null)}
                    onChange={e => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) { 
                        updateBody({ maxKineticEnergy: val } as any);
                      }
                    }} className="font-mono text-[12px] text-white bg-black/40 px-3 py-2 rounded-xl border border-white/5 w-full outline-none" />
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Label</span>
                <input 
                  type="text" 
                  value={focusedField === 'name' ? undefined : body.name} 
                  onFocus={() => setFocusedField('name')}
                  onBlur={() => setFocusedField(null)}
                  onChange={e => updateBody({ name: e.target.value })}
                  className="font-mono text-[13px] text-white bg-black/40 px-3 py-2.5 rounded-xl border border-white/5 w-full outline-none focus:border-blue-500/50 transition-all"
                />
            </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Mass</span>
            <div className="flex items-center w-full bg-black/40 rounded-xl border border-white/5 overflow-hidden">
              <button 
                onClick={() => {
                  const m = Math.max(1e-26, body.mass / 2);
                  updateBody({ mass: m });
                  setMassUnit(getOptimalUnit(m, massUnits));
                }} 
                className="px-2 py-2 text-[10px] font-bold text-gray-500 hover:text-white hover:bg-white/5 transition-colors border-r border-white/5 shrink-0"
              >/2</button>
              <div className="flex items-center flex-1 min-w-0">
                <input 
                  type="text"
                  value={focusedField === 'mass' ? undefined : (body.mass === 0 ? "0" : (body.mass / massUnits[massUnit]).toExponential(2).replace('e+0', ''))}
                  onFocus={() => setFocusedField('mass')}
                  onBlur={() => setFocusedField(null)}
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) updateBody({ mass: val * massUnits[massUnit] });
                  }}
                  className="font-mono text-[12px] text-white bg-transparent flex-1 text-right outline-none px-2 py-2 min-w-0"
                />
                <select 
                  value={massUnit}
                  onChange={(e) => setMassUnit(e.target.value as any)}
                  className="text-[10px] text-[var(--color-accent-blue)] bg-transparent font-bold pr-2 outline-none cursor-pointer uppercase tracking-tight shrink-0"
                >
                   {Object.keys(massUnits).map(u => <option key={u} value={u} className="bg-[#0f172a]">{u}</option>)}
                </select>
              </div>
              <button 
                onClick={() => {
                  const m = body.mass * 2;
                  updateBody({ mass: m });
                  setMassUnit(getOptimalUnit(m, massUnits));
                }} 
                className="px-2 py-2 text-[10px] font-bold text-gray-500 hover:text-white hover:bg-white/5 transition-colors border-l border-white/5 shrink-0"
              >x2</button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">
              {sim.isBodyBlackHole(body) ? 'Gravitational Throat' : ((body as any).type?.includes('rocket') ? 'Length' : 'Radius')}
            </span>
            <div className="flex items-center w-full bg-black/40 rounded-xl border border-white/5 overflow-hidden">
              <button 
                disabled={sim.isBodyBlackHole(body)}
                onClick={() => {
                  const step = (body as any).type?.includes('rocket') ? (body.radius * 2 / 2) : (body.radius / 2);
                  const r = Math.max(1e-15, step);
                  updateBody({ radius: (body as any).type?.includes('rocket') ? r / 2 : r });
                  setRadiusUnit(getOptimalUnit(r, radiusUnits));
                }} 
                className={`px-2 py-2 text-[10px] font-bold text-gray-500 hover:text-white hover:bg-white/5 transition-colors border-r border-white/5 shrink-0 ${sim.isBodyBlackHole(body) ? 'opacity-30 cursor-not-allowed' : ''}`}
              >/2</button>
              <div className="flex items-center flex-1 min-w-0">
                <input 
                  type="text"
                  disabled={sim.isBodyBlackHole(body)}
                  value={focusedField === 'radius' ? undefined : (((body as any).type?.includes('rocket') ? (body.radius * 2) : body.radius) / radiusUnits[radiusUnit])}
                  onFocus={() => setFocusedField('radius')}
                  onBlur={() => setFocusedField(null)}
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      const finalR = (body as any).type?.includes('rocket') ? (val * radiusUnits[radiusUnit] / 2) : (val * radiusUnits[radiusUnit]);
                      updateBody({ radius: finalR });
                    }
                  }}
                  className={`font-mono text-[12px] text-white bg-transparent flex-1 text-right outline-none px-2 py-2 min-w-0 ${sim.isBodyBlackHole(body) ? 'text-blue-400 font-bold' : ''}`}
                />
                <select 
                  value={radiusUnit}
                  onChange={(e) => setRadiusUnit(e.target.value as any)}
                  className="text-[10px] text-[var(--color-accent-blue)] bg-transparent font-bold pr-2 outline-none cursor-pointer uppercase tracking-tight shrink-0"
                >
                   {Object.keys(radiusUnits).map(u => <option key={u} value={u} className="bg-[#0f172a]">{u}</option>)}
                </select>
              </div>
              <button 
                disabled={sim.isBodyBlackHole(body)}
                onClick={() => {
                  const r = (body as any).type?.includes('rocket') ? (body.radius * 2 * 2) : (body.radius * 2);
                  updateBody({ radius: (body as any).type?.includes('rocket') ? r / 2 : r });
                  setRadiusUnit(getOptimalUnit(r, radiusUnits));
                }} 
                className={`px-2 py-2 text-[10px] font-bold text-gray-500 hover:text-white hover:bg-white/5 transition-colors border-l border-white/5 shrink-0 ${sim.isBodyBlackHole(body) ? 'opacity-30 cursor-not-allowed' : ''}`}
              >x2</button>
            </div>
          </div>
          {sim.isBodyBlackHole(body) && (
            <div className="text-[9px] text-blue-400 mt-[-8px] text-right pr-2 italic opacity-70">
              Locked to mass (Singularity)
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Surface Color</span>
            <div className="flex items-center gap-3 bg-black/40 px-3 py-2.5 rounded-xl border border-white/5">
              <input 
                type="color" 
                value={body.color.startsWith('hsl') ? '#ffffff' : body.color}
                onChange={e => updateBody({ color: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer bg-[#facc15] border-2 border-white p-0 shrink-0"
                style={{ background: body.color }}
              />
              <span className="font-mono text-[13px] text-white uppercase">{body.color}</span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="text-[10px] uppercase tracking-[2px] text-gray-500 mb-4 font-bold">
          TELEMETRY // LIVE
        </div>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Relative Velocity</span>
            <div className="flex items-center bg-black/40 border border-white/5 rounded-xl w-full overflow-hidden">
              <input 
                type="text"
                readOnly
                value={(Math.sqrt(body.velocity.x**2 + body.velocity.y**2) / speedUnits[speedUnit]).toFixed(2)}
                className="font-mono text-[12px] text-blue-400 bg-transparent flex-1 text-right outline-none px-3 py-2.5"
              />
              <select 
                value={speedUnit}
                onChange={(e) => setSpeedUnit(e.target.value as any)}
                className="text-[10px] text-blue-500 bg-transparent font-bold pr-2 outline-none cursor-pointer uppercase tracking-tight"
              >
                 {Object.keys(speedUnits).map(u => <option key={u} value={u} className="bg-[#11141b]">{u}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Position X</span>
            <div className="font-mono text-[13px] text-white bg-black/40 px-3 py-2.5 rounded-xl border border-white/5 w-full text-right">
              {body.position.x.toFixed(1)}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Position Y</span>
            <div className="font-mono text-[13px] text-white bg-black/40 px-3 py-2.5 rounded-xl border border-white/5 w-full text-right">
              {body.position.y.toFixed(1)}
            </div>
          </div>
        </div>
      </section>
    </section>

    <div className="mt-auto pt-4 border-t border-white/10 grid grid-cols-2 gap-2">
        <button 
          onClick={() => {
            sim.camera.followingId = sim.camera.followingId === body.id ? null : body.id;
          }}
          title={sim.camera.followingId === body.id ? 'Stop Follow' : 'Follow Camera'}
          className={`w-full py-2 flex items-center justify-center rounded-xl text-[12px] font-semibold tracking-wider transition-colors border ${
            sim.camera.followingId === body.id 
              ? 'bg-[var(--color-accent-blue)] border-[var(--color-accent-blue)] text-white' 
              : 'bg-[#1e293b] border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Camera size={18} />
        </button>

        <button 
          onClick={() => {
            sim.bodies = sim.bodies.filter(b => b.id !== body.id);
            onClose();
          }}
          title="Delete Object"
          className="w-full py-2 flex items-center justify-center rounded-xl text-[12px] font-semibold tracking-wider transition-colors border bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white"
        >
          <Trash2 size={18} />
        </button>

        <button 
          onClick={() => {
            const isStar = sim.isStar(body);
            sim.explosions.push({
              x: body.position.x,
              y: body.position.y,
              radius: body.radius * (isStar ? 180 : 25), 
              time: 0,
              maxTime: isStar ? 30.0 : 2.5,
              isSupernova: isStar,
              seed: Math.random() * 1000
            });
            sim.bodies = sim.bodies.filter(b => b.id !== body.id);
            onClose();
          }}
          className={`w-full py-2 flex items-center justify-center rounded-xl text-[10px] uppercase font-bold tracking-widest transition-colors border col-span-2 ${
            sim.isStar(body) 
              ? 'bg-purple-600/20 border-purple-600/40 text-purple-400 hover:bg-purple-600/40 hover:shadow-[0_0_30px_rgba(124,58,237,0.4)]' 
              : 'bg-red-600/20 border-red-600/40 text-red-500 hover:bg-red-600/40 hover:shadow-[0_0_20px_rgba(220,38,38,0.3)]'
          }`}
        >
          {sim.isStar(body) ? 'Trigger Supernova' : 'Self-Destruct (Test Explosion)'}
        </button>
      </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

export function getBodyType(sim: Simulation, body: Body): string {
    // 1. Önce Kara Delik Kontrolü (Olay Ufku ve Kütle İlişkisi)
    if (sim.isBodyBlackHole(body)) return 'Black Hole';

    // 2. Yoğunluk Hesabı (Basitleştirilmiş ρ = M / R²)
    // 2D simülasyonda alan yoğunluğu üzerinden gitmek görsel olarak daha tutarlıdır.
    const density = body.mass / (body.radius * body.radius);

    // 3. YILDIZLAR (Güneş kütlesi ~198,900)
    if (body.mass > 5000) {
        // Kütle çok yüksek ama yarıçap çok küçükse -> Egzotik Yıldızlar
        if (body.radius < 1) return 'Neutron Star';
        if (body.radius < 5) return 'White Dwarf';
        
        // Normal Yıldız Boyutları
        if (body.mass > 1000000) return 'Hypermassive Star';
        if (body.mass > 500000) return 'Supergiant Star';
        return 'Main Sequence Star';
    }

    // 4. GEZEGENLER VE UYDULAR (Dünya kütlesi ~0.597, Jüpiter ~189.8)
    if (body.mass > 100) {
        // Jüpiter ve Satürn gibi Gaz Devleri genelde düşüktür yoğunlukludur
        return 'Gas Giant'; 
    }
    
    if (body.mass > 0.1) {
        // Kayalık (Dünya tipi) gezegenlerin yoğunluğu yüksektir
        if (density > 1) return 'Terrestrial Planet (Rocky)';
        return 'Minor Planet';
    }

    if (body.mass > 0.001) {
        // Ay (0.0073) bu aralığa girer
        return 'Moon / Satellite';
    }

    // 5. KÜÇÜK CİSİMLER
    return 'Asteroid / Comet';
}
