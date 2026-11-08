<script setup lang="ts">
import { withBase } from 'vitepress'

withDefaults(defineProps<{ items: [string, string][]; size?: number }>(), { size: 210 })
</script>

<template>
  <div class="shot-strip">
    <figure v-for="[src, caption] in items" :key="src" class="shot-strip-item" :style="{ width: size + 'px' }">
      <img :src="withBase(src)" :alt="caption" loading="lazy" />
      <figcaption>{{ caption }}</figcaption>
    </figure>
  </div>
</template>
