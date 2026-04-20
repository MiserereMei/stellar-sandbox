import * as PIXI from 'pixi.js';

async function main() {
    const app = new PIXI.Application();
    await app.init({ width: 100, height: 100 });
    
    const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void)
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

    const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
void main() {
    finalColor = vec4(1.0, 0.0, 0.0, 1.0);
}
`;

    try {
        const filter = PIXI.Filter.from({
            gl: { vertex, fragment }
        });
        console.log("Filter.from succeeded!");
        app.stage.filters = [filter];
        
        // Let it render one frame
        app.render();
        console.log("Render succeeded!");
    } catch (e) {
        console.error("Filter error:", e.message || e);
    }
    
    process.exit(0);
}

main();
