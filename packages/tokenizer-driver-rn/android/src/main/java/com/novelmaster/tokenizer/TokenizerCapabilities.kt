package com.novelmaster.tokenizer

/**
 * 当前构建是否带 SentencePiece native。
 *
 * DJL 从未发布 Android 版 sentencepiece-native（官方 discussion #3742），
 * 当前 APK 里也没有 libsentencepiece_native.so，构造 SpTokenizer 必然失败。
 * 与其在运行时靠异常类型推断（DJL 抛的是 IllegalStateException 而非
 * LinkageError，catch 不住），不如把「有没有 SP native」钉成构建期常量。
 *
 * 恢复 SP 支持需要三件事同时做，本常量只负责能力声明：
 *   1. 自编译 arm64 libsentencepiece_native.so 并打进 jniLibs
 *   2. 重新引入 .model 资产到 assets/tokenizers/
 *   3. 恢复 countSpFamily / loadSpTokenizer 与 dispatch 的 model 分支
 */
internal const val SENTENCEPIECE_NATIVE_AVAILABLE = false

/**
 * 该资产 spec 是否落在「需要 SP native 但当前构建没有」的区间。
 *
 * 纯函数、不依赖 Context，放在资产读取之前判定：命中即抛，省掉 `.model`
 * 拷贝与一次必然失败的 JNI 构造。资产表当前已无 `kind="model"` 条目，这个
 * 分支是未来恢复 SP 的锚点，由单测覆盖两种 kind 输入。
 */
internal fun isSpUnavailableSpec(spec: AssetPathSpec): Boolean =
  spec.kind == "model" && !SENTENCEPIECE_NATIVE_AVAILABLE
