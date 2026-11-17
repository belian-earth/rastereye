// The `lerc` package's ES build has named exports only, but geotiff.js imports
// it as a default. Re-export both shapes so every importer shares one module
// instance (and therefore one loaded WebAssembly decoder).
import * as Lerc from "../../node_modules/lerc/LercDecode.es.js";
export * from "../../node_modules/lerc/LercDecode.es.js";
export default Lerc;
