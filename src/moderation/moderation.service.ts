import { Injectable } from '@nestjs/common';

/**
 * Lista de palavrões em português (expandir conforme necessário)
 */
const DIRTY_WORDS = new Set([
  // Palavrões comuns
  'merda',
  'bosta',
  'porra',
  'caralho',
  'cacete',
  'puta',
  'puto',
  'fdp',
  'filho da puta',
  'filha da puta',
  'vai se foder',
  'foda',
  'foder',
  'fodido',
  'fodida',
  'cu',
  'cuzao',
  'cuzão',
  'arrombado',
  'arrombada',
  'viado',
  'viada',
  'desgraça',
  'desgraçado',
  'desgraçada',
  'inferno',
  'droga',
  'buceta',
  'boceta',
  'piroca',
  'rola',
  'pau',
  'babaca',
  'otario',
  'otário',
  'otaria',
  'otária',
  'imbecil',
  'idiota',
  'burro',
  'burra',
  'estupido',
  'estúpido',
  'estupida',
  'estúpida',
  'vagabundo',
  'vagabunda',
  'lazarento',
  'lazarenta',
  'maldito',
  'maldita',
  'nojento',
  'nojenta',
]);

/**
 * Padrões que indicam desistência do jogo
 */
const GIVEUP_PATTERNS = [
  /\b(desisto|desistir|desisti)\b/i,
  /\b(cansei|cansado|cansada)\b/i,
  /\b(não\s+(quero|aguento|consigo)\s+mais)\b/i,
  /\b(nao\s+(quero|aguento|consigo)\s+mais)\b/i,
  /\b(para|parar|parei)\s+(com\s+isso|o\s+jogo)\b/i,
  /\b(chega|basta)\b/i,
  /\b(sair|saindo|vou\s+sair)\b/i,
  /\b(deixa\s+pra\s+l[aá])\b/i,
  /\b(to\s+fora|tô\s+fora|estou\s+fora)\b/i,
  /\b(encerr(ar|ei|o)|finaliz(ar|ei|o))\b/i,
  /\b(n[aã]o\s+quero\s+jogar)\b/i,
  /\b(muito\s+dif[ií]cil)\b/i,
  /\b(impossivel|impossível)\b/i,
];

export interface ModerationResult {
  hasDirtyWord: boolean;
  hasGiveup: boolean;
  dirtyWordsFound: string[];
  giveupPhraseFound: string | null;
}

@Injectable()
export class ModerationService {
  /**
   * Normaliza o texto para comparação (remove acentos, lowercase)
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Verifica se o texto contém palavrões
   */
  detectDirtyWords(text: string): { hasDirtyWord: boolean; wordsFound: string[] } {
    const normalized = this.normalizeText(text);
    const words = normalized.split(/\s+/);
    const found: string[] = [];

    // Verifica palavras individuais
    for (const word of words) {
      const cleanWord = word.replace(/[^\p{L}]/gu, '');
      if (DIRTY_WORDS.has(cleanWord)) {
        found.push(cleanWord);
      }
    }

    // Verifica frases compostas (ex: "filho da puta")
    for (const dirtyWord of DIRTY_WORDS) {
      if (dirtyWord.includes(' ') && normalized.includes(dirtyWord)) {
        found.push(dirtyWord);
      }
    }

    return {
      hasDirtyWord: found.length > 0,
      wordsFound: [...new Set(found)],
    };
  }

  /**
   * Verifica se o texto indica desistência
   */
  detectGiveup(text: string): { hasGiveup: boolean; phraseFound: string | null } {
    const normalized = this.normalizeText(text);

    for (const pattern of GIVEUP_PATTERNS) {
      const match = normalized.match(pattern);
      if (match) {
        return {
          hasGiveup: true,
          phraseFound: match[0],
        };
      }
    }

    return {
      hasGiveup: false,
      phraseFound: null,
    };
  }

  /**
   * Analisa uma mensagem e retorna todos os flags de moderação
   */
  analyzeMessage(text: string): ModerationResult {
    if (!text || typeof text !== 'string') {
      return {
        hasDirtyWord: false,
        hasGiveup: false,
        dirtyWordsFound: [],
        giveupPhraseFound: null,
      };
    }

    const dirtyResult = this.detectDirtyWords(text);
    const giveupResult = this.detectGiveup(text);

    return {
      hasDirtyWord: dirtyResult.hasDirtyWord,
      hasGiveup: giveupResult.hasGiveup,
      dirtyWordsFound: dirtyResult.wordsFound,
      giveupPhraseFound: giveupResult.phraseFound,
    };
  }

  /**
   * Versão simplificada que retorna apenas os flags booleanos
   * (para uso em pipelines de processamento)
   */
  getFlags(text: string): { hasDirtyWord: boolean; hasGiveup: boolean } {
    const result = this.analyzeMessage(text);
    return {
      hasDirtyWord: result.hasDirtyWord,
      hasGiveup: result.hasGiveup,
    };
  }
}
