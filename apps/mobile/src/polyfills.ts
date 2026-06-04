/**
 * Hermes polyfills for js-tiktoken and other web APIs (must load before App).
 * Tokenizer model weights live in Android assets only — no Metro loader here.
 */
import 'fast-text-encoding';
import {installMobilePromptTokenCounter} from './tokenizer/mobile-prompt-token-counter';

installMobilePromptTokenCounter();
