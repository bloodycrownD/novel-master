"""把 SentencePiece `.model` 转成 HuggingFace `tokenizer.json`，并用原版 SP 对拍。

用途：Android 端没有 SentencePiece native（DJL 不提供 `ai.djl.android:sentencepiece-native`），
SP 家族（gemma/llama/mistral/yi/jamba）此前静默落 JS cl100k 兜底。转成 HF `tokenizer.json`
后可以直接走已有的 `libdjl_tokenizer.so`（HuggingFaceTokenizer），零新 native 依赖。

用法：
    python scripts/convert-sp-to-hf.py                       # 转换 WRITE_FAMILIES 并写盘
    python scripts/convert-sp-to-hf.py --check               # 对拍全部家族，不写文件
    python scripts/convert-sp-to-hf.py --family yi --check   # 只对拍 yi

退出码：0 = 无 FAIL；1 = 有 FAIL（默认 `--check` 会因 yi/jamba 的 ±1 偏差返回 1，
那是**对拍结果、不是门禁**——Android 侧已不保留这两族的任何资产，见
`TokenizerCapabilities.kt`）。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# `.model` 源在 Node 驱动（desktop 走 SP WASM，那边五个 model 都还在）；
# 产物写进 Android assets。同一个 PR 里 Android 侧的 .model 已经被删，脚本
# 不能从那里读——否则转换过程不可复现。
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = PACKAGE_ROOT.parent / "tokenizer-driver-node/assets/tokenizers"
ASSETS = PACKAGE_ROOT / "android/src/main/assets/tokenizers"

# 家族 → SP 模型文件名（同目录下）。
FAMILIES = {
    "gemma": "gemma.model",
    "llama": "llama.model",
    "mistral": "mistral.model",
    "yi": "yi.model",
    "jamba": "jamba.model",
}

# 只有对拍逐 token 等值的三个家族才写盘——yi/jamba 转换后偏差 ±1，且 Android
# 侧已无 SP native（`.model` 条目随能力位化删除），写了没有消费者，白占安装包。
WRITE_FAMILIES = {"gemma", "llama", "mistral"}

PARITY_TEXTS = [
    "hello world",
    "这是一段中文正文，用于验证 SentencePiece 与 HuggingFace 转换后的分词一致性。",
    "Mixed 中英 text with numbers 12345 and punctuation, plus emoji 🙂.",
    "第一章 风起\n\n夜色如墨，山道上只有一盏孤灯。" * 20,
    "a" * 500,
    "def fibonacci(n):\n    return n if n < 2 else fibonacci(n-1) + fibonacci(n-2)",
]


def load_slow(family: str, model_path: Path):
    """按家族挑慢分词器类：gemma 用 GemmaTokenizer，其余 SP 家族同构、用 LlamaTokenizer。"""
    if family == "gemma":
        from transformers.models.gemma.tokenization_gemma import GemmaTokenizer

        return GemmaTokenizer(vocab_file=str(model_path), legacy=False)
    from transformers.models.llama.tokenization_llama import LlamaTokenizer

    return LlamaTokenizer(vocab_file=str(model_path), legacy=False)


def convert(family: str, model_name: str, write: bool) -> bool | None:
    """转换并回传对拍结果：True = PASS，False = FAIL，None = SKIP（源模型缺失）。"""
    model_path = MODEL_DIR / model_name
    out_path = ASSETS / f"{family}.json"
    if not model_path.exists():
        print(f"[skip] {family}: {model_path.name} missing in {MODEL_DIR}")
        return None

    try:
        import sentencepiece as spm
        from transformers.convert_slow_tokenizer import convert_slow_tokenizer
        from transformers import PreTrainedTokenizerFast
    except ImportError as exc:  # pragma: no cover - 环境缺依赖时直接报错
        print(f"[fatal] missing dependency: {exc}")
        return False

    slow = load_slow(family, model_path)
    fast = convert_slow_tokenizer(slow)
    blob = json.loads(fast.to_str())

    sp = spm.SentencePieceProcessor(model_file=str(model_path))
    # 对拍口径：两边都取「裸 encode 的 token 数」。不比 id 值——HF 慢分词器
    # 转换时会重排 vocab，id 空间整体偏移，长度才是计数口径。
    # 用 tokenizer_object 而不是 tokenizer_file：--check 不落盘时没有 json 可读。
    hf = PreTrainedTokenizerFast(tokenizer_object=fast)

    ok = True
    print(f"\n=== {family} ({model_name} → {out_path.name}) ===")
    for text in PARITY_TEXTS:
        sp_ids = sp.encode(text)
        hf_ids = hf.encode(text, add_special_tokens=False)
        # 只比长度：两边 id 空间可能整体偏移（HF 慢分词器会重排 vocab），长度才是计数口径
        same = len(sp_ids) == len(hf_ids)
        ok = ok and same
        label = "OK " if same else "DIFF"
        print(f"  [{label}] sp={len(sp_ids):5d} hf={len(hf_ids):5d}  {text[:40]!r}")
    print(
        f"  vocab_size: {blob.get('model', {}).get('vocab', {}) and len(blob['model']['vocab']) or 'n/a'}"
    )

    # 先对拍、后写盘：对拍失败时坏资产不能先落进 assets（写盘不可逆，return 1
    # 只是退出码，坏 json 会留在工作区）。
    if write and ok:
        # SP 的 byte-fallback 词表里本来就有 U+FFFD 字符（如 '▁' 后跟替换符），
        # 项目的 check-encoding 会把它们判成「源码被写坏」而拦下提交。写成 JSON
        # 转义 \\ufffd 后语义完全等价（解析器还原同一字符），字符串层面干净。
        out_path.write_text(
            fast.to_str().replace("\ufffd", "\\ufffd"), encoding="utf-8"
        )
    elif write:
        print(f"  [skip-write] {family} 对拍未通过，不落盘")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="只对拍，不写 json")
    parser.add_argument(
        "--family",
        help=f"只处理某个家族（可选：{', '.join(FAMILIES)}）",
    )
    args = parser.parse_args()

    if args.family is not None and args.family not in FAMILIES:
        print(f"[fatal] 未知家族: {args.family}（可选：{', '.join(FAMILIES)}）")
        return 2

    families = {args.family: FAMILIES[args.family]} if args.family else FAMILIES
    results: dict[str, bool | None] = {}
    for family, model_name in families.items():
        if not args.check and family not in WRITE_FAMILIES:
            print(f"[skip] {family}: 不在 WRITE_FAMILIES，仅 --check 时对拍")
            results[family] = None
            continue
        results[family] = convert(family, model_name, write=not args.check)

    failed = [f for f, ok in results.items() if ok is False]
    print("\n=== summary ===")
    for family, ok in results.items():
        status = "PASS" if ok is True else ("SKIP" if ok is None else "FAIL")
        print(f"  {family}: {status}")
    if any(ok is None for ok in results.values()):
        print("  （SKIP = 源模型缺失，或不在 WRITE_FAMILIES 且未加 --check）")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
