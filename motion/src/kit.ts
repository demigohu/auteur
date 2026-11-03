// The fonts and helpers every scene can use: `import { fonts } from "@auteur/kit"`. Fonts ship in the
// bundle (no network at render time); the host waits for them before the first frame.
import "@fontsource/anton/latin-400.css";
import "@fontsource/bebas-neue/latin-400.css";
import "@fontsource/caveat/latin-400.css";
import "@fontsource/caveat/latin-700.css";
import "@fontsource/dm-serif-display/latin-400.css";
import "@fontsource/dm-serif-display/latin-400-italic.css";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-900.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/montserrat/latin-500.css";
import "@fontsource/montserrat/latin-800.css";
import "@fontsource/montserrat/latin-900.css";
import "@fontsource/playfair-display/latin-400.css";
import "@fontsource/playfair-display/latin-700.css";
import "@fontsource/playfair-display/latin-400-italic.css";
import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/space-grotesk/latin-700.css";

/** CSS font-family values, with the weights that are loaded. */
export const fonts = {
  anton: "'Anton', sans-serif", // 400 only: tall condensed display caps
  bebas: "'Bebas Neue', sans-serif", // 400 only: condensed caps
  inter: "'Inter', sans-serif", // 400, 500, 700, 900
  grotesk: "'Space Grotesk', sans-serif", // 400, 700
  montserrat: "'Montserrat', sans-serif", // 500, 800, 900
  playfair: "'Playfair Display', serif", // 400, 700, 400 italic
  dmSerif: "'DM Serif Display', serif", // 400, 400 italic
  instrument: "'Instrument Serif', serif", // 400, 400 italic
  mono: "'JetBrains Mono', monospace", // 400, 700
  hand: "'Caveat', cursive", // 400, 700
};

/** Every face above, as `document.fonts.load` descriptors. */
export const FACES = [
  "400 1em Anton", "400 1em 'Bebas Neue'", "400 1em Caveat", "700 1em Caveat", "400 1em 'DM Serif Display'",
  "italic 400 1em 'DM Serif Display'", "400 1em 'Instrument Serif'", "italic 400 1em 'Instrument Serif'",
  "400 1em Inter", "500 1em Inter", "700 1em Inter", "900 1em Inter", "400 1em 'JetBrains Mono'",
  "700 1em 'JetBrains Mono'", "500 1em Montserrat", "800 1em Montserrat", "900 1em Montserrat",
  "400 1em 'Playfair Display'", "700 1em 'Playfair Display'", "italic 400 1em 'Playfair Display'",
  "400 1em 'Space Grotesk'", "700 1em 'Space Grotesk'",
];
