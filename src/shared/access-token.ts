export const accessTokenLimits = { min: 16, max: 256 } as const;
export type AccessTokenSource = 'file' | 'environment';

export function validNewAccessToken(value: string) {
  return (
    value.length >= accessTokenLimits.min &&
    value.length <= accessTokenLimits.max &&
    value.trim() === value &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}
