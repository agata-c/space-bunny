/**
 * Materials for the pastel world.
 *
 * One MeshStandardMaterial family, differentiated by roughness / emissive, so
 * the whole scene stays coherent and the renderer can batch happily.
 */

import * as THREE from 'three';
import { LOOK, hex, num } from '../game/look.js';
import { PALETTE } from '../core/palette.js';

/** Shared soft-plastic material for anything painted with vertex colours. */
export function softPlastic({
  roughness = 0.68,
  metalness = 0.0,
  emissive = 0x000000,
  emissiveIntensity = 0,
  transparent = false,
  opacity = 1,
  flatShading = true,
  vertexColors = true,
  envMapIntensity = 0.55
} = {}) {
  return new THREE.MeshStandardMaterial({
    vertexColors,
    color: 0xffffff,
    roughness,
    metalness,
    flatShading,
    emissive,
    emissiveIntensity,
    transparent,
    opacity,
    envMapIntensity
  });
}

/**
 * Low-power fallback: `?lite` in the URL, or a coarse pointer (touch device).
 *
 * The transmissive path costs a whole extra render pass of the scene; on phones
 * that is the difference between 60 fps and 30, so the glass becomes a tinted
 * skin instead. It must still read as glass — thin, pink, with the back-side
 * sheen layered on top — never as solid plastic.
 */
function isLiteMode() {
  try {
    if (new URLSearchParams(location.search).has('lite')) return true;
  } catch {
    /* no location (SSR / worker): never lite */
  }
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * The glass terrarium.
 *
 * Full path: transmissive, tinted by attenuation, a little iridescent for the
 * blue edge sheen. Lite path: a thin tinted skin (opacity 0.22, no
 * transmission) — the fresnel edges do the work instead.
 */
export function glassMaterial({ lite = isLiteMode() } = {}) {
  const m = lite
    ? new THREE.MeshPhysicalMaterial({
        color: PALETTE.glassTint,
        roughness: 0.08,
        metalness: 0.0,
        transmission: 0,
        transparent: true,
        opacity: 0.22,
        ior: 1.3,
        // same grazing-edge treatment as the full glass, so ?lite has no dark
        // outline either
        clearcoat: 0,
        clearcoatRoughness: 0.08,
        side: THREE.DoubleSide,
        envMapIntensity: 0.55,
        specularIntensity: 0.55,
        depthWrite: false
      })
    : new THREE.MeshPhysicalMaterial({
        // Round 1i item 4: the bowl read WHITE. On a transmissive material
        // color multiplies the transmission, so this lilac-pink is what tints
        // the whole interior (target #B58AF5-#C391DB).
        color: hex(LOOK.glass.color, 0xfbf7fe),
        roughness: 0.04,
        metalness: 0.0,
        // Round 1d: NO dark outline, and NO pink veil over the contents. At
        // transmission 0.9 ten percent of the surface shading still mixed in,
        // and because the environment and fill lights are pink that alone put
        // +36 to +69 red into every leaf facet (a mint blade measured #429EA8
        // with the glass off and #66A1AF with it on). At 1.0 the pixel is
        // purely what is behind the glass. The grazing edge used to go
        // grey-black as well, because at near-normal incidence the fresnel
        // term is ~1 and the surface reflected the dark side of the
        // environment while iridescence added a second, hue-shifting
        // reflection: clearcoat 1 -> 0.35, iridescence 0.3 -> 0 and
        // envMapIntensity 1.15 -> 0.55 take the edge to a pink #C8ACCC.
        transmission: num(LOOK.glass.transmission, 1.0),
        thickness: num(LOOK.glass.thickness, 0.875),
        ior: num(LOOK.glass.ior, 1.3),
        transparent: true,
        opacity: 1,
        // Reviewer fix 2026-10-05 (Agata: "the glass got an inside shadow"): with
        // DoubleSide the sphere's back wall stacked over the front wall near the
        // silhouette, drawing a dark band just inside the edge (scanline L dip
        // 0.51 vs 0.66, interior 0.81 vs 0.83). FrontSide removes it.
        side: THREE.FrontSide,
        clearcoat: num(LOOK.glass.clearcoat, 0.35),
        clearcoatRoughness: 0.04,
        iridescence: 0,
        iridescenceIOR: 1.3,
        attenuationColor: new THREE.Color(hex(LOOK.glass.attenuationColor, 0xe6d8fa)),
        // long, so the glass only whispers its pink tint: at 5 the attenuation
        // was strong enough to lay a magenta veil over the whole interior
        // 14 was the clear/grey look; 6 gives the pastel pink-purple body
        attenuationDistance: num(LOOK.glass.attenuationDistance, 30),
        envMapIntensity: num(LOOK.glass.envMapIntensity, 1.3),
        specularIntensity: num(LOOK.glass.specularIntensity, 0.55),
        depthWrite: false
      });

  /**
   * Round 1m: push LOOK.glass into this material live. Registered by the terrarium
   * when it builds the bowl, so the ?tune panel's Glass folder works without a
   * reload. The lite path is left alone - it is a different material shape.
   */
  // Reviewer fix 2026-10-05 (Agata: the glass outline read BLACK, off-palette).
  // The grazing edge was a desaturated grey (#BA90C3) from the white clearcoat /
  // env reflection. clearcoat is 0 in LOOK now, and a fresnel rim tints the edge
  // toward a palette violet instead: darker, but in colour (#B081DD at the edge).
  const rimU = {
    rimColor: { value: new THREE.Color(hex(LOOK.glass.rimColor, 0x8c5bd0)) },
    rimStrength: { value: num(LOOK.glass.rimStrength, 0.85) },
    rimPower: { value: num(LOOK.glass.rimPower, 3.0) }
  };
  if (!lite) {
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, rimU);
      sh.fragmentShader =
        'uniform vec3 rimColor;\nuniform float rimStrength;\nuniform float rimPower;\n' +
        sh.fragmentShader.replace(
          '#include <dithering_fragment>',
          'float rimF = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), rimPower);\n' +
            'gl_FragColor.rgb = mix(gl_FragColor.rgb, rimColor, rimF * rimStrength);\n' +
            '#include <dithering_fragment>'
        );
    };
    m.customProgramCacheKey = () => 'glass-palette-rim';
  }

  m.userData.applyLook = () => {
    if (lite) return;
    rimU.rimColor.value.setHex(hex(LOOK.glass.rimColor, 0x8c5bd0));
    rimU.rimStrength.value = num(LOOK.glass.rimStrength, 0.85);
    rimU.rimPower.value = num(LOOK.glass.rimPower, 3.0);
    m.color.setHex(hex(LOOK.glass.color, 0xfbf7fe));
    m.transmission = num(LOOK.glass.transmission, 1.0);
    m.thickness = num(LOOK.glass.thickness, 0.875);
    m.ior = num(LOOK.glass.ior, 1.3);
    m.clearcoat = num(LOOK.glass.clearcoat, 0.35);
    m.attenuationColor.setHex(hex(LOOK.glass.attenuationColor, 0xe6d8fa));
    m.attenuationDistance = num(LOOK.glass.attenuationDistance, 30);
    m.envMapIntensity = num(LOOK.glass.envMapIntensity, 1.3);
    m.specularIntensity = num(LOOK.glass.specularIntensity, 0.55);
  };

  // terrarium.setGlassOpacity() fades the bowl for the finale: it needs to know
  // which values "fully visible" means for this flavour of glass.
  m.userData.lite = lite;
  m.userData.baseOpacity = m.opacity;
  m.userData.baseTransmission = m.transmission;
  return m;
}

/** Thin additive sheen laid over the glass to fake rim reflections. */
export function glassSheenMaterial(tint = 0xffffff) {
  return new THREE.MeshBasicMaterial({
    // Round 1j: pink instead of white, so the glass carries its own hue.
    // Round 1k item 3: the tint is white now and the hue comes from the sheen
    // sphere's own vertex ramp (pink left edge -> violet right edge), so this
    // colour multiplies the ramp instead of flattening it to one hue.
    opacity: 0.16,
    side: THREE.BackSide,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending
  });
}

/**
 * Rim ring, segment joints, platform and pedestal: SMOOTH and glossy, not
 * faceted (SPEC 3), with the pink-to-lilac gradient baked into vertex colours.
 *
 * `emissive` is the "light pink, not deep mauve" lever the R1c brief asks for:
 * `color` is already white so it cannot lift anything, and the rimA -> rimB
 * vertex gradient is already pale (sweeping lighter stops only moved the
 * pedestal by ~2 points). Nearly all of the missing lightness is light the
 * shell never receives -- the key is up and to the left, the blue rim and edge
 * are behind -- so a pale-pink emissive is what actually fixes it. Measured on
 * the lower pedestal's outer wall it takes the worst error against #F3C6EC
 * across front / left flank / right flank from 18.2% to 8.6%.
 */
export function shellMaterial({
  roughness = 0.25,
  envMapIntensity = 0.5,
  emissive = 0xe7c6f5,
  emissiveIntensity = 0.12,
  clearcoat = 0.3
} = {}) {
  return new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    color: 0xffffff,
    emissive,
    emissiveIntensity,
    roughness,
    metalness: 0.0,
    flatShading: false,
    clearcoat: clearcoat,
    clearcoatRoughness: 0.15,
    envMapIntensity
  });
}

/** Glowing gold: stars, constellation nodes, connections. */
export function goldMaterial({ emissiveIntensity = 0.9, roughness = 0.28, metalness = 0.55 } = {}) {
  return new THREE.MeshStandardMaterial({
    color: PALETTE.gold,
    roughness,
    metalness,
    emissive: PALETTE.goldDeep,
    emissiveIntensity,
    flatShading: true,
    vertexColors: false,
    envMapIntensity: 1.0
  });
}

/** Dark glossy eyes. */
export function eyeMaterial() {
  return new THREE.MeshStandardMaterial({
    color: PALETTE.eye,
    roughness: 0.15,
    metalness: 0.1,
    flatShading: false,
    envMapIntensity: 1.4
  });
}

/**
 * Blush — soft pink, deliberately optional.
 *
 * Deliberately OPAQUE: three.js renders only opaque objects into the glass's
 * transmission buffer, so a transparent blush is simply missing when you look at
 * the bunny through the bowl. Opaque is safe here because the squashed sphere
 * intersects the head instead of lying flat on it.
 */
export function blushMaterial() {
  return new THREE.MeshStandardMaterial({
    color: PALETTE.blush,
    roughness: 0.85,
    metalness: 0,
    flatShading: false,
    emissive: PALETTE.blush,
    emissiveIntensity: 0.1
  });
}

// R4b item 1: tableMaterial() and additiveSprite() lived here and were never
// imported by anything (tools/deadcode.mjs), so they are gone.