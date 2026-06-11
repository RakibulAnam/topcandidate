// Domain — profile-item normalization ("polished profile").
//
// Converts one raw profile description (possibly Banglish / unstructured) into
// clean professional evidence: canonical English bullets, evidenced skills,
// and coaching gaps. Runs ONCE on profile save (not per generation) so every
// later resume/toolkit generation starts from a stable, pre-cleaned form.

import { NormalizedItemContent } from '../entities/Resume';

export interface ProfileItemContext {
  role?: string;
  company?: string;
}

export interface IProfileItemNormalizer {
  normalize(text: string, context: ProfileItemContext): Promise<NormalizedItemContent>;
}

export class NormalizeProfileItemUseCase {
  constructor(private normalizer: IProfileItemNormalizer) {}

  async execute(text: string, context: ProfileItemContext): Promise<NormalizedItemContent> {
    return this.normalizer.normalize(text, context);
  }
}
