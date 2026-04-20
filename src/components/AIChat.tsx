import React, { useState } from 'react';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { Simulation, Body, generateId } from '../lib/Simulation';
import { Sparkles, Loader2, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AIChatProps {
  sim: Simulation;
  show: boolean;
  onClose: () => void;
  anchorRect?: { left: number, top: number };
}

export const AIChat: React.FC<AIChatProps> = ({ sim, show, onClose, anchorRect }) => {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [debugStream, setDebugStream] = useState('');
  const [showDebug, setShowDebug] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isLoading) return;

    setIsLoading(true);
    setDebugStream('');

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
         throw new Error("GEMINI_API_KEY environment variable is not set.");
      }

      const ai = new GoogleGenAI({ apiKey });

      const stateSnapshot = {
         bodies: sim.bodies.map(b => ({
           id: b.id, name: b.name, mass: b.mass, radius: b.radius, color: b.color,
           position: { x: b.position.x, y: b.position.y },
           velocity: { x: b.velocity.x, y: b.velocity.y }
         })),
         G: sim.G
      };

      const sysInstruction = `
You are AstroForge AI, an expert at generating physics simulations and orbital mechanics scenarios.
The user will describe a star system, a configuration of bodies, or a modification to the current scene.
Generate the complete list of bodies that should exist after the user's request.
Return a valid JSON object matching the provided schema.

Current state context:
- G constant is ${sim.G}.
- For realistic orbits, velocity conceptually scales with sqrt(G * CentralMass / distance).
- STABILITY RULE 1: To prevent n-body chaos in solar systems, the central star MUST be tremendously more massive than the planets. (e.g. Stars: 10000-50000 mass. Planets: 1-50 mass).
- STABILITY RULE 2: Space planets significantly far apart from one another.
- Assign beautiful distinct HSL colors for planets and stars (e.g., "hsl(40, 100%, 50%)" for a star, "hsl(200, 80%, 60%)" for earth-like).
`;

      const stream = await ai.models.generateContentStream({
         model: 'gemini-3-flash-preview',
         contents: [
            { role: 'user', parts: [{ text: `Current state: ${JSON.stringify(stateSnapshot)}. Request: ${prompt}` }] }
         ],
         config: {
            systemInstruction: sysInstruction,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                 bodies: {
                    type: Type.ARRAY,
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
                      required: ['id', 'name', 'mass', 'radius', 'color', 'position', 'velocity']
                    }
                 }
              },
              required: ['bodies']
            }
         }
      });

      let fullText = '';
      for await (const chunk of stream) {
         const chunkText = chunk.text || '';
         fullText += chunkText;
         setDebugStream(prev => prev + chunkText);
         console.log('[AI STREAM CHUNK]:', chunkText);
      }

      const data = JSON.parse(fullText);

      if (data && Array.isArray(data.bodies)) {
         sim.bodies = data.bodies.map((b: any) => ({
             id: typeof b.id === 'string' && b.id.length > 0 ? b.id : generateId(),
             name: b.name || 'Unknown Body',
             mass: typeof b.mass === 'number' ? b.mass : 100,
             radius: typeof b.radius === 'number' ? b.radius : 10,
             color: typeof b.color === 'string' ? b.color : '#ffffff',
             position: { x: b.position?.x || 0, y: b.position?.y || 0 },
             velocity: { x: b.velocity?.x || 0, y: b.velocity?.y || 0 }
         }));
      }

      setPrompt('');
    } catch (err: any) {
      console.error(err);
      alert("AI Generation failed: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div 
          style={anchorRect ? { 
            left: anchorRect.left, 
            bottom: window.innerHeight - anchorRect.top + 16 
          } : undefined}
          initial={{ opacity: 0, y: 20, x: "-50%" }}
          animate={{ opacity: 1, y: 0, x: "-50%" }}
          exit={{ opacity: 0, y: 20, x: "-50%" }}
          className={`fixed ${!anchorRect && 'bottom-[100px] left-1/2'} w-[360px] pointer-events-none z-[100] will-change-transform`}
        >
          <div className="bg-[#11141b]/45 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-4 pointer-events-auto flex flex-col gap-5">

        <div className="text-[10px] uppercase tracking-[2px] text-gray-500 flex items-center justify-between font-bold">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-purple-400" />
            <span>AI COORDINATOR</span>
          </div>
        </div>
        
        <div className="text-[11px] text-gray-400 space-y-4">
          <div className="flex items-center justify-between">
            <p className="leading-relaxed opacity-80">Command the stellar environment using physical intentions.</p>
            <button 
              onClick={() => setShowDebug(!showDebug)} 
              className={`text-[8px] px-1.5 py-0.5 rounded border transition-colors ${showDebug ? 'bg-purple-500/20 text-purple-300 border-purple-500/50' : 'bg-white/5 text-gray-600 border-white/10'}`}
            >
              STREAM MONITOR
            </button>
          </div>

          {showDebug && debugStream && (
            <div className="bg-black/60 p-3 rounded-xl border border-purple-500/20 font-mono text-[9px] text-purple-300/70 max-h-[150px] overflow-y-auto break-all animate-in zoom-in-95 duration-200">
               <div className="flex items-center gap-2 mb-2 text-purple-400 font-bold border-b border-purple-500/10 pb-1">
                  <Loader2 size={10} className="animate-spin" />
                  <span>INCOMING VECTORS</span>
               </div>
               {debugStream}
            </div>
          )}

          {!debugStream && (
            <div className="space-y-2">
              <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-gray-300 italic text-[11px] hover:border-purple-500/30 transition-colors cursor-default">
                "Create a binary black hole system with high orbital eccentricity."
              </div>
              <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-gray-300 italic text-[11px] hover:border-purple-500/30 transition-colors cursor-default">
                "Add a supergiant star surrounded by a dense asteroid field."
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="relative mt-2">
           <input 
              type="text"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Input stellar vector command..."
              className="bg-black/40 border border-white/5 rounded-xl py-3 pl-4 pr-12 w-full text-[var(--color-text-main)] text-[13px] outline-none focus:border-purple-500/50 transition-all font-mono"
              disabled={isLoading}
           />
           <button 
             type="submit" 
             disabled={isLoading || !prompt.trim()}
             className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-400 hover:text-purple-300 disabled:opacity-20 disabled:hover:text-purple-400 bg-transparent border-none p-0 cursor-pointer"
           >
             {isLoading ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
           </button>
        </form>
      </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
