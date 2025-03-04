// make a name into a valid javascript identifier, as pleasantly as possible.

export function sanitize(identifier: string): string {
  // first we opportunistically do camelization when an illegal character is not
  // the first character and is followed by a lowercase letter, in an effort to
  // aid readability of the output.
  let cleaned = identifier.replace(
    new RegExp(`(?<!^)(?:${illegalChar.source})([a-z])`, 'g'),
    (_m, letter) => letter.toUpperCase()
  );
  // then we unliterally strip all remaining illegal characters.
  cleaned = cleaned.replace(new RegExp(illegalChar.source, 'g'), '');
  return cleaned;
}

const illegalChar = /^[^a-zA-Z_$]|(?<=.)[^a-zA-Z_$0-9]/;
