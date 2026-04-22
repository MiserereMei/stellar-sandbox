/// <reference types="vite/client" />

// Allow importing any file as a raw string with the ?raw suffix
declare module '*?raw' {
  const content: string;
  export default content;
}
