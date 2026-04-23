import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { Simulation, generateId } from '../lib/Simulation';
import { Sparkles, Loader2, Send, ChevronDown, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import FC_API_DOC from '../../FLIGHT_CONTROL_API.md?raw';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  text?: string;       // only shown when AI explicitly speaks
  toolCalls?: string[]; // tool names executed (for subtle indicators)
}

interface AIChatProps {
  sim: Simulation;
  show: boolean;
  onClose: () => void;
  anchorRect?: { left: number; top: number; side?: 'left' | 'right' };
  apiKey: string;
  onSetApiKey?: (key: string) => void;
}

// ─── Tool Definitions (MCP-style) ────────────────────────────────────────────

const TOOLS = [
  {
    name: 'replace_all_bodies',
    description: 'Replaces the entire simulation with a new set of celestial bodies. Use for "create a solar system", "build a binary star", etc.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        bodies: {
          type: Type.ARRAY,
          description: 'Full list of bodies to populate the simulation with.',
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              name: { type: Type.STRING },
              mass: { type: Type.NUMBER },
              radius: { type: Type.NUMBER },
              color: { type: Type.STRING },
              position: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } } },
              velocity: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } } },
            },
            required: ['id', 'name', 'mass', 'radius', 'color', 'position', 'velocity'],
          },
        },
        G: { type: Type.NUMBER, description: 'Optional: override gravitational constant. Default: 1.541e-6.' },
      },
      required: ['bodies'],
    },
  },
  {
    name: 'add_body',
    description: 'Adds a single new celestial body to the existing simulation without disturbing other bodies.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        mass: { type: Type.NUMBER },
        radius: { type: Type.NUMBER },
        color: { type: Type.STRING },
        position: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } } },
        velocity: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } } },
      },
      required: ['name', 'mass', 'radius', 'color', 'position', 'velocity'],
    },
  },
  {
    name: 'remove_body',
    description: 'Removes a celestial body from the simulation by name.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Exact name of the body to remove (e.g. "Mars", "Moon").' },
      },
      required: ['name'],
    },
  },
  {
    name: 'load_preset',
    description: 'Loads a built-in simulation preset, replacing current state.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        preset: {
          type: Type.STRING,
          description: 'One of: solar_system, rocket_system, real_scale_solar_system, asteroid_belt, trisolar_system, meteor_shower, black_hole_system, orbit_mission, rocket_on_earth, black_hole_devour',
        },
      },
      required: ['preset'],
    },
  },
  {
    name: 'load_vehicle',
    description: 'Places a rocket vehicle on the surface of a named planet or body in the current simulation. If no bodyName is given, uses the largest body.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        bodyName: { type: Type.STRING, description: 'Name of the planet/body to land the rocket on. e.g. "Earth", "Mars".' },
        vehicleType: { type: Type.STRING, description: '"rocket" (standard Artemis SLS, default) or "heatProtectedRocket" (heat-shielded variant for reentry scenarios).' },
      },
    },
  },
  {
    name: 'set_simulation_speed',
    description: 'Sets the simulation time scale (e.g. 1 = realtime, 100 = 100x speed).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        timeScale: { type: Type.NUMBER },
      },
      required: ['timeScale'],
    },
  },
  {
    name: 'inject_autopilot_script',
    description: 'Injects and runs a JavaScript autopilot script on the rocket vehicle. The script must define `function autopilotStep(t, fc) { ... }`.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        script: { type: Type.STRING, description: 'Valid JavaScript autopilot script string.' },
      },
      required: ['script'],
    },
  },
  {
    name: 'set_camera',
    description: 'Controls the simulation camera — zoom level and which body to follow.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        followBodyName: { type: Type.STRING, description: 'Name of the body to follow. Optional.' },
        zoom: { type: Type.NUMBER, description: 'Camera zoom level. Optional.' },
      },
    },
  },
  {
    name: 'speak',
    description: 'Use ONLY when you cannot fulfill the request silently — e.g., ambiguous command, impossible request, or clarification needed. Keep it very brief.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        message: { type: Type.STRING },
      },
      required: ['message'],
    },
  },
];

// ─── Tool Executor ────────────────────────────────────────────────────────────

function executeTool(name: string, args: any, sim: Simulation, onScript?: (s: string) => void): string {
  try {
    switch (name) {
      case 'replace_all_bodies': {
        if (args.G) sim.G = args.G;
        sim.bodies = (args.bodies || []).map((b: any) => ({
          id: typeof b.id === 'string' && b.id.length > 0 ? b.id : generateId(),
          name: b.name || 'Body',
          mass: b.mass ?? 1,
          radius: b.radius ?? 1,
          color: b.color ?? '#ffffff',
          position: { x: b.position?.x ?? 0, y: b.position?.y ?? 0 },
          velocity: { x: b.velocity?.x ?? 0, y: b.velocity?.y ?? 0 },
          trail: [],
          ...(b.isBlackHole ? { isBlackHole: true } : {}),
        }));
        sim.vehicle = null;
        sim.camera.followingId = sim.bodies[0]?.id ?? null;
        return `Loaded ${sim.bodies.length} bodies.`;
      }

      case 'add_body': {
        const b = args;
        sim.bodies.push({
          id: generateId(),
          name: b.name || 'Body',
          mass: b.mass ?? 1,
          radius: b.radius ?? 1,
          color: b.color ?? '#ffffff',
          position: { x: b.position?.x ?? 0, y: b.position?.y ?? 0 },
          velocity: { x: b.velocity?.x ?? 0, y: b.velocity?.y ?? 0 },
          trail: [],
          ...(b.isBlackHole ? { isBlackHole: true } : {}),
        });
        return `Added "${b.name}".`;
      }

      case 'load_vehicle': {
        const targetName = args.bodyName?.toLowerCase();
        const planet = targetName
          ? sim.bodies.find(b => b.name.toLowerCase().includes(targetName) && b !== sim.vehicle)
          : sim.bodies.filter(b => b !== sim.vehicle).sort((a, b2) => b2.mass - a.mass)[0];
        if (!planet) return `Body "${args.bodyName}" not found.`;

        // Artemis SLS metadata (mirrors getBodyMetadataFromPreset 'rocket')
        const length = 1.538e-5;
        const rocketMeta = {
          mass: 4.353e-19,
          radius: length / 2,
          length,
          color: '#ffffff',
          thrustPower: 2.5e-6,
          maxKineticEnergy: 20000,
        };

        // Place on top of planet (north pole = negative Y)
        const surfaceOffset = { x: 0, y: -(planet.radius + rocketMeta.radius) };
        const rocket: any = {
          id: generateId(),
          name: 'Artemis SLS',
          mass: rocketMeta.mass,
          radius: rocketMeta.radius,
          length: rocketMeta.length,
          color: rocketMeta.color,
          position: {
            x: planet.position.x + surfaceOffset.x,
            y: planet.position.y + surfaceOffset.y,
          },
          velocity: { x: planet.velocity.x, y: planet.velocity.y },
          trail: [],
          type: args.vehicleType || 'rocket',
          rotation: -Math.PI / 2,
          angularVelocity: 0,
          isHeatProtected: args.vehicleType === 'heatProtectedRocket',
          thrustPower: rocketMeta.thrustPower,
          maxKineticEnergy: rocketMeta.maxKineticEnergy,
          parentBodyId: planet.id,
          relativeOffset: surfaceOffset,
        };
        sim.bodies.push(rocket);
        sim.vehicle = rocket;
        sim.camera.followingId = rocket.id;
        sim.camera.zoom = 2000000;
        return `Rocket placed on "${planet.name}".`;
      }

      case 'remove_body': {
        const before = sim.bodies.length;
        sim.bodies = sim.bodies.filter(body => body.name.toLowerCase() !== args.name?.toLowerCase());
        const removed = before - sim.bodies.length;
        return removed > 0 ? `Removed "${args.name}".` : `Body "${args.name}" not found.`;
      }

      case 'load_preset': {
        const presetMap: Record<string, () => void> = {
          solar_system: () => sim.loadSolarSystem(),
          rocket_system: () => sim.loadRocketSystem(),
          real_scale_solar_system: () => sim.loadRealScaleSolarSystem(),
          asteroid_belt: () => sim.loadAsteroidBelt(),
          trisolar_system: () => sim.loadTrisolarSystem(),
          meteor_shower: () => sim.loadMeteorShower(),
          black_hole_system: () => sim.loadBlackHoleSystem(),
          orbit_mission: () => sim.loadOrbitMission(),
          rocket_on_earth: () => sim.loadRocketOnEarth(),
          black_hole_devour: () => sim.loadBlackHoleDevour(),
        };
        const fn = presetMap[args.preset];
        if (fn) { fn(); return `Loaded preset: ${args.preset}`; }
        return `Unknown preset: ${args.preset}`;
      }

      case 'set_simulation_speed': {
        sim.timeScale = args.timeScale ?? 1;
        return `Speed set to ${sim.timeScale}x.`;
      }

      case 'inject_autopilot_script': {
        if (onScript) onScript(args.script);
        return 'Autopilot script injected.';
      }

      case 'set_camera': {
        if (args.zoom != null) sim.camera.zoom = args.zoom;
        if (args.followBodyName) {
          const target = sim.bodies.find(b => b.name.toLowerCase() === args.followBodyName.toLowerCase());
          if (target) sim.camera.followingId = target.id;
        }
        return 'Camera updated.';
      }

      case 'speak':
        return args.message ?? '';

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: any) {
    return `Tool error: ${err.message}`;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export const AIChat: React.FC<AIChatProps & { onInjectScript?: (s: string) => void }> = ({
  sim, show, onClose, anchorRect, apiKey, onInjectScript, onSetApiKey
}) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  // Raw Gemini multi-turn history (user/model parts)
  const historyRef = useRef<{ role: string; parts: { text: string }[] }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');
    setIsLoading(true);

    // Add user message to UI
    setMessages(prev => [...prev, { role: 'user', text: userText }]);

    // Add to Gemini history
    historyRef.current.push({ role: 'user', parts: [{ text: userText }] });

    try {
      if (!apiKey) throw new Error('API key missing.');

      const ai = new GoogleGenAI({ apiKey });

      // Snapshot current sim state as context
      const simSnapshot = {
        G: sim.G,
        timeScale: sim.timeScale,
        bodyCount: sim.bodies.length,
        bodies: sim.bodies.map(b => ({
          id: b.id, name: b.name, mass: b.mass, radius: b.radius,
          position: b.position, velocity: b.velocity,
        })),
        hasVehicle: !!sim.vehicle,
      };

      const systemInstruction = `
You are Astro, a silent AI operator for a gravity physics simulation.

BEHAVIOR RULES:
- You operate by calling tools. Do NOT write text responses unless absolutely necessary.
- Only call "speak" if the request is genuinely ambiguous, impossible, or requires clarification.
- Never confirm actions with text ("Done!", "I've created...", etc). Just execute.
- For solar systems and complex scenes, use "replace_all_bodies".
- For small modifications, use "add_body" or "remove_body".
- Prefer "load_preset" for built-in scenarios when the user's intent matches one.
- Use "load_vehicle" to place a rocket on any specific planet/body in the current scene.

AVAILABLE PRESETS (use with load_preset tool):
- solar_system: Classic Sun + planets orbiting system
- rocket_system: Rocket vehicle with Earth
- real_scale_solar_system: Realistic scale solar system
- asteroid_belt: Sun with asteroid belt
- trisolar_system: Chaotic 3-star system (Three-Body Problem)
- meteor_shower: Meteor shower scenario
- black_hole_system: Black hole with orbiting bodies
- orbit_mission: Guided orbital insertion mission
- rocket_on_earth: Rocket on Earth surface ready to launch
- black_hole_devour: Black hole devouring the solar system

PHYSICS CONTEXT:
- G = ${sim.G} (gravitational constant)
- For stable orbits: velocity ≈ sqrt(G * central_mass / distance)
- Central body must be >> orbiting body mass for n-body stability
- Use beautiful distinct HSL colors

BODY TYPES & PROPERTIES:
- Normal star/planet: { name, mass, radius, color, position, velocity } — no extra flags
- BLACK HOLE: Add "isBlackHole": true to the body object. Use mass 1e7–1e10, radius ~0.5–5, color "#000000". Example:
  { "id": "bh1", "name": "Singularity", "mass": 5000000, "radius": 1.5, "color": "#000000", "isBlackHole": true, "position": {...}, "velocity": {...} }
- Smaller black holes as "planets": same isBlackHole: true, just lower mass (50000–500000) and closer orbits
- For a black hole system: central BH mass ~1e7, orbiting BH mass ~5e4–1e5, orbit distance 5–30 units

MASS REFERENCE:
- Stars: 10000–50000 | Planets: 1–50 | Moons: 0.01–1
- Central black hole: 1e6–1e8 | Orbiting black holes: 5e4–5e5

CURRENT SIMULATION STATE:
${JSON.stringify(simSnapshot, null, 2)}

AUTOPILOT SCRIPTING REFERENCE (fc API — use when writing inject_autopilot_script):
${FC_API_DOC}
`.trim();

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-preview',
        contents: historyRef.current as any,
        config: {
          systemInstruction,
          tools: [{
            functionDeclarations: TOOLS.map(t => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            }))
          }],
        },
      });

      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];

      const toolCallNames: string[] = [];
      let spokenText: string | undefined;

      // Add model response to history
      historyRef.current.push({
        role: 'model',
        parts: parts.map((p: any) => {
          if (p.text) return { text: p.text };
          if (p.functionCall) return { text: `[tool:${p.functionCall.name}]` };
          return { text: '' };
        }),
      });

      // Execute all tool calls
      for (const part of parts) {
        if (part.functionCall) {
          const { name, args } = part.functionCall;
          const result = executeTool(name, args, sim, onInjectScript);
          toolCallNames.push(name);
          if (name === 'speak') {
            spokenText = result;
          }
        } else if (part.text?.trim()) {
          // AI wrote text without using speak tool — show it
          spokenText = (spokenText ?? '') + part.text.trim();
        }
      }

      // Update UI messages
      const assistantMsg: Message = { role: 'assistant' };
      if (toolCallNames.length > 0) assistantMsg.toolCalls = toolCallNames.filter(n => n !== 'speak');
      if (spokenText) assistantMsg.text = spokenText;

      if (assistantMsg.toolCalls?.length || assistantMsg.text) {
        setMessages(prev => [...prev, assistantMsg]);
      }

    } catch (err: any) {
      console.error(err);
      const errStr = JSON.stringify(err) + (err.message || '') + (err.status || '');
      const isUnavailable = errStr.includes('503') || errStr.includes('UNAVAILABLE');
      if (isUnavailable) {
        // Roll back: remove last user message from UI and history, restore to input
        setMessages(prev => prev.slice(0, -1));
        historyRef.current = historyRef.current.slice(0, -1);
        setInput(userText);
        // Show transient "busy" indicator that auto-clears
        setMessages(prev => [...prev, { role: 'assistant', text: '⏳ Server busy — press Enter to retry.' }]);
        setTimeout(() => setMessages(prev => prev.filter(m => m.text !== '⏳ Server busy — press Enter to retry.')), 3000);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', text: `⚠ ${err.message}` }]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const toolLabel: Record<string, string> = {
    load_vehicle: 'Vehicle deployed',
    replace_all_bodies: 'System rebuilt',
    add_body: 'Body added',
    remove_body: 'Body removed',
    load_preset: 'Preset loaded',
    set_simulation_speed: 'Speed adjusted',
    inject_autopilot_script: 'Autopilot injected',
    set_camera: 'Camera updated',
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          style={anchorRect ? {
            left: anchorRect.side === 'left' ? anchorRect.left : undefined,
            right: anchorRect.side === 'right' ? (window.innerWidth - anchorRect.left) : undefined,
            bottom: '80px',
          } : undefined}
          initial={{ opacity: 0, y: 20, x: anchorRect ? 0 : '-50%' }}
          animate={{ opacity: 1, y: 0, x: anchorRect ? 0 : '-50%' }}
          exit={{ opacity: 0, y: 20, x: anchorRect ? 0 : '-50%' }}
          className={`fixed ${!anchorRect ? 'bottom-[100px] left-1/2' : ''} w-[380px] pointer-events-none z-[100] will-change-transform`}
        >
          <div className="bg-[#11141b]/60 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl flex flex-col pointer-events-auto overflow-hidden" style={{ maxHeight: '520px' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/5">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[2px] text-gray-500 font-bold">
                <Sparkles size={13} className="text-purple-400" />
                <span>AI COORDINATOR</span>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Message History */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0" style={{ maxHeight: '360px' }}>
              {messages.length === 0 && !apiKey && (
                // ── No API Key: prompt message ─────────────────────────────
                <div className="space-y-2 pt-1 text-center">
                  <div className="text-2xl">🔑</div>
                  <p className="text-[12px] text-gray-300 font-medium">API Key Required</p>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    Paste your Gemini API key below to get started.{' '}
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-purple-400 hover:underline">
                      Get one here.
                    </a>
                  </p>
                </div>
              )}

              {messages.length === 0 && apiKey && (
                // ── Has key: example prompts ───────────────────────────────
                <div className="space-y-2 pt-1">
                  {[
                    'Create a binary black hole system.',
                    'Add a moon to the largest planet.',
                    'Load rocket on Earth and set speed to 300x.',
                  ].map((ex, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(ex)}
                      className="w-full text-left bg-black/30 px-3 py-2.5 rounded-xl border border-white/5 text-gray-400 italic text-[11px] hover:border-purple-500/30 hover:text-gray-300 transition-all"
                    >
                      "{ex}"
                    </button>
                  ))}
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'user' ? (
                    <div className="bg-purple-600/20 border border-purple-500/20 rounded-xl px-3 py-2 text-[12px] text-gray-200 max-w-[85%]">
                      {msg.text}
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-w-[90%]">
                      {/* Silent tool indicators */}
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {msg.toolCalls.map((t, j) => (
                            <span
                              key={j}
                              className="text-[9px] uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full"
                            >
                              ✓ {toolLabel[t] ?? t}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Spoken text (only when AI uses speak tool) */}
                      {msg.text && (
                        <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-[12px] text-gray-300">
                          {msg.text}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 text-gray-600 text-[11px]">
                    <Loader2 size={12} className="animate-spin text-purple-400" />
                    <span>Processing...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-white/5 px-3 py-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!apiKey) {
                    // Use input as API key
                    if (input.trim() && onSetApiKey) {
                      onSetApiKey(input.trim());
                      setInput('');
                    }
                  } else {
                    handleSubmit(e);
                  }
                }}
                className="relative"
              >
                <input
                  type={!apiKey ? 'password' : 'text'}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={!apiKey ? 'Paste your Gemini API key...' : 'Command the simulation...'}
                  className="bg-black/40 border border-white/5 rounded-xl py-2.5 pl-4 pr-11 w-full text-[13px] text-gray-200 outline-none focus:border-purple-500/50 transition-all font-mono placeholder:text-gray-600"
                  disabled={isLoading}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400 hover:text-purple-300 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                >
                  {isLoading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                </button>
              </form>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
