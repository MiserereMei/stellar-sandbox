
export interface ExoplanetData {
    name: string;
    mass: number; // Jupiter masses
    radius: number; // Jupiter radii
    period: number; // days
    semimajoraxis: number; // AU
    eccentricity: number;
    hoststar_mass: number; // Solar masses
    hoststar_radius: number; // Solar radii
    hoststar_temp: number; // K
    distance: number; // parsecs
}

export interface PlanetarySystem {
    name: string;
    star: {
        mass: number;
        radius: number;
        temp: number;
    };
    planets: ExoplanetData[];
}

class OECCatalogue {
    private systems: PlanetarySystem[] = [];
    private loading = false;
    private loaded = false;

    async fetchCatalogue(): Promise<PlanetarySystem[]> {
        if (this.loaded) return this.systems;
        if (this.loading) return [];

        this.loading = true;
        try {
            const response = await fetch('https://raw.githubusercontent.com/OpenExoplanetCatalogue/oec_tables/master/comma_separated/open_exoplanet_catalogue.txt');
            const text = await response.text();
            this.parseCSV(text);
            this.loaded = true;
            return this.systems;
        } catch (err) {
            console.error("Failed to load OEC data:", err);
            return [];
        } finally {
            this.loading = false;
        }
    }

    private parseCSV(text: string) {
        const lines = text.split('\n');
        const systemsMap = new Map<string, PlanetarySystem>();

        // Skip header lines (Source info and column names)
        // Find header index
        const headerIdx = lines.findIndex(l => l.startsWith('name,binaryflag'));
        if (headerIdx === -1) return;

        for (let i = headerIdx + 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const cols = line.split(',');
            if (cols.length < 24) continue;

            const planetName = cols[0];
            const rawMass = parseFloat(cols[2]);
            const rawRadius = parseFloat(cols[3]);
            
            // OEC provides values in Jupiter units. 
            // If one is missing, we can estimate it for a more realistic simulation
            let mass = isNaN(rawMass) ? 0 : rawMass;
            let radius = isNaN(rawRadius) ? 0 : rawRadius;

            // Simple mass-radius relationship for exoplanets if one is missing
            // (Mass in M_jup, Radius in R_jup)
            if (mass === 0 && radius > 0) {
                // If it's small (Earth-like), use rocky density
                if (radius < 0.1) mass = Math.pow(radius * 11.2, 2.0) / 317.8;
                // If it's large, use gas giant density
                else mass = Math.pow(radius, 3) * 0.5; // Rough estimate
            } else if (radius === 0 && mass > 0) {
                radius = Math.pow(mass, 1/3);
            }

            const period = parseFloat(cols[4]) || 0;
            const axis = parseFloat(cols[5]) || 0;
            const ecc = parseFloat(cols[6]) || 0;
            const starMass = parseFloat(cols[19]) || 1.0;
            const starRadius = parseFloat(cols[20]) || 1.0;
            const starTemp = parseFloat(cols[22]) || 5778;

            const systemName = planetName.split(' ').slice(0, -1).join(' ') || planetName;

            if (!systemsMap.has(systemName)) {
                systemsMap.set(systemName, {
                    name: systemName,
                    star: { mass: starMass, radius: starRadius, temp: starTemp },
                    planets: []
                });
            }

            const sys = systemsMap.get(systemName)!;
            sys.planets.push({
                name: planetName,
                mass, radius, period, semimajoraxis: axis, eccentricity: ecc,
                hoststar_mass: starMass, hoststar_radius: starRadius, hoststar_temp: starTemp,
                distance: parseFloat(cols[18]) || 0
            });
        }

        this.systems = Array.from(systemsMap.values())
            .filter(s => s.planets.some(p => p.semimajoraxis > 0)) // Only keep systems with valid orbital data
            .sort((a, b) => b.planets.length - a.planets.length); // Most populated first
    }

    getFeaturedSystems() {
        return this.systems.slice(0, 50); // Top 50 systems
    }

    search(query: string) {
        const q = query.toLowerCase();
        return this.systems.filter(s => s.name.toLowerCase().includes(q)).slice(0, 10);
    }
}

export const catalogue = new OECCatalogue();
