import { Color, type Material } from "three";

/** The shirt's cyan lettering is baked into the shared character-sheet texture. */
export const recolorRenLogo = (material: Material, color: string): Material => {
  const copy = material.clone();
  const logoColor = new Color(color);
  copy.onBeforeCompile = (shader) => {
    shader.uniforms.renLogoColor = { value: logoColor };
    shader.fragmentShader = `uniform vec3 renLogoColor;\n${shader.fragmentShader}`.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      #ifdef USE_MAP
        float logoChroma = min(sampledDiffuseColor.g, sampledDiffuseColor.b) - sampledDiffuseColor.r;
        float logoMask = smoothstep(0.015, 0.08, logoChroma);
        diffuseColor.rgb = mix(diffuseColor.rgb, renLogoColor, logoMask);
      #endif`,
    );
  };
  copy.customProgramCacheKey = () => "ren-logo-color-v1";
  return copy;
};
