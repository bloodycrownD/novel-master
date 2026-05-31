/**
 * Markdown file preview with Front Matter card and themed body rendering.
 */
import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {splitMarkdownFrontMatter} from '@novel-master/core/front-matter';
import type {ThemeTokens} from '../../theme/tokens';
import {RichContentBody} from '../rich-content/RichContentBody';
import {parseFrontMatterFields} from './front-matter-fields';

const MARKDOWN_PATH = /\.(md|markdown)$/i;

export function isMarkdownPreviewPath(path: string): boolean {
  return MARKDOWN_PATH.test(path);
}

interface FileMarkdownPreviewProps {
  path: string;
  content: string;
  tokens: ThemeTokens;
}

export function FileMarkdownPreview({
  path,
  content,
  tokens,
}: FileMarkdownPreviewProps) {
  const useMarkdown = isMarkdownPreviewPath(path);
  const split = useMemo(
    () => (useMarkdown ? splitMarkdownFrontMatter(content) : null),
    [content, useMarkdown],
  );

  const fmLines = split?.frontMatterLines ?? null;
  const showFrontMatter = useMarkdown && fmLines !== null;
  const fmFields =
    showFrontMatter && split?.closed
      ? parseFrontMatterFields(fmLines)
      : [];
  const body =
    useMarkdown && split?.closed ? (split.body ?? '').trim() : '';

  if (!content.trim()) {
    return (
      <Text style={[styles.empty, {color: tokens.textSecondary}]}>
        （空文件）
      </Text>
    );
  }

  if (!useMarkdown) {
    return (
      <Text style={[styles.plain, {color: tokens.text}]}>{content}</Text>
    );
  }

  return (
    <View style={styles.root}>
      {showFrontMatter ? (
        <FrontMatterCard
          tokens={tokens}
          fields={fmFields}
          invalid={!split?.closed}
          empty={split?.closed === true && fmLines.length === 0}
          rawLines={!split?.closed ? fmLines : undefined}
        />
      ) : null}
      {!split?.closed ? (
        <Text style={{color: tokens.textSecondary, fontSize: 14}}>
          请返回编辑并补全结束的 --- 后再预览正文。
        </Text>
      ) : null}
      {body ? (
        <RichContentBody
          content={body}
          tokens={tokens}
          variant="file-preview"
        />
      ) : split?.closed && showFrontMatter ? (
        <Text style={{color: tokens.textSecondary, fontSize: 14}}>
          （正文为空）
        </Text>
      ) : null}
    </View>
  );
}

interface FrontMatterCardProps {
  tokens: ThemeTokens;
  fields: {key: string; value: string}[];
  invalid: boolean;
  empty: boolean;
  rawLines?: string[];
}

function FrontMatterCard({
  tokens,
  fields,
  invalid,
  empty,
  rawLines,
}: FrontMatterCardProps) {
  return (
    <View
      style={[
        styles.fmCard,
        {
          backgroundColor: tokens.bgSecondary,
          borderColor: tokens.border,
        },
      ]}>
      <Text style={[styles.fmTitle, {color: tokens.textSecondary}]}>
        Front Matter
      </Text>
      {invalid ? (
        <Text style={[styles.fmError, {color: tokens.danger}]}>
          格式无效：缺少结束的 --- 分隔线
        </Text>
      ) : null}
      {empty ? (
        <Text style={{color: tokens.textSecondary, fontSize: 13}}>
          （空 Front Matter）
        </Text>
      ) : null}
      {!invalid && !empty
        ? fields.map((field, index) => (
            <View key={`${field.key}-${index}`} style={styles.fmRow}>
              {field.key ? (
                <Text
                  style={[styles.fmKey, {color: tokens.textSecondary}]}
                  numberOfLines={1}>
                  {field.key}
                </Text>
              ) : null}
              <Text style={[styles.fmValue, {color: tokens.text}]}>
                {field.value}
              </Text>
            </View>
          ))
        : null}
      {invalid && rawLines?.length
        ? rawLines.map((line, index) => (
            <Text
              key={index}
              style={[styles.fmValue, {color: tokens.text, fontFamily: 'monospace'}]}>
              {line}
            </Text>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {gap: 16},
  empty: {fontSize: 14},
  plain: {fontFamily: 'monospace', fontSize: 14, lineHeight: 20},
  fmCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  fmTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fmError: {fontSize: 13},
  fmRow: {gap: 2},
  fmKey: {fontSize: 12, fontWeight: '500'},
  fmValue: {fontSize: 15, lineHeight: 21},
});
