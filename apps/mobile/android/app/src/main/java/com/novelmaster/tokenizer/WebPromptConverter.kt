package com.novelmaster.tokenizer

/**
 * ST-aligned web tokenizer prompt conversion (parity with core
 * `convertMessagesForWebTokenizer`).
 */
internal object WebPromptConverter {
  fun wrapSerializedAsSystemMessage(serialized: String): Pair<String, String> {
    return "system" to serialized
  }

  fun convertMessages(messages: List<Pair<String, String>>): String {
    val parts = mutableListOf<String>()
    for ((roleRaw, content) in messages) {
      val role = roleRaw.lowercase()
      when (role) {
        "system" -> parts.add(content)
        "user", "human" -> parts.add("\n\nHuman: $content")
        "assistant" -> parts.add("\n\nAssistant: $content")
        else -> parts.add("\n\n$roleRaw: $content")
      }
    }
    if (parts.none { it.contains("Assistant:") }) {
      parts.add("\n\nAssistant:")
    }
    return parts.joinToString("").trimStart()
  }

  fun countWebSerialized(serialized: String, encode: (String) -> Int): Int {
    val wrapped = listOf(wrapSerializedAsSystemMessage(serialized))
    val converted = convertMessages(wrapped)
    return encode(converted)
  }
}
