/**
 * Hermes polyfills for js-tiktoken and other web APIs (must load before App).
 */
import 'fast-text-encoding';
import {installMobileTokenizerLoader} from './tokenizer/mobile-tokenizer-loader';
import {installMobilePromptTokenCounter} from './tokenizer/mobile-prompt-token-counter';

installMobileTokenizerLoader();
installMobilePromptTokenCounter();
