import { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import RenderHtml from 'react-native-render-html';

import { getResolvedApiBase, toApiUrl } from '@/constants/api';

type Props = {
  instruction: string;
};

const hasHtmlMarkup = (value: string): boolean => /<[^>]+>/.test(value);

const normalizeImageSrc = (rawSrc: string): string => {
  const src = (rawSrc || '').trim();
  if (!src) return src;

  if (/^https?:\/\//i.test(src)) {
    try {
      const parsed = new URL(src);
      const host = parsed.hostname.toLowerCase();
      if (host === '127.0.0.1' || host === 'localhost') {
        const base = new URL(getResolvedApiBase());
        return `${base.origin}${parsed.pathname}${parsed.search}`;
      }
      return src;
    } catch {
      return src;
    }
  }

  if (src.startsWith('/')) {
    return toApiUrl(src);
  }

  if (/^(api\/)?uploads\//i.test(src)) {
    return toApiUrl(`/${src.replace(/^\/+/, '')}`);
  }

  return src;
};

const absolutizeInstructionImages = (instruction: string): string => {
  return instruction.replace(/src\s*=\s*(["'])([^"']+)\1/gi, (_m, quote, src) => {
    return `src=${quote}${normalizeImageSrc(src)}${quote}`;
  });
};

const enforceResponsiveImages = (instruction: string): string => {
  return instruction.replace(/<img\b([^>]*)>/gi, (_m, attrs) => {
    const withoutWidth = attrs
      .replace(/\swidth\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\sheight\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

    const styleMatch = withoutWidth.match(/style\s*=\s*(["'])(.*?)\1/i);
    const existingStyle = styleMatch ? styleMatch[2] : '';
    const cleanedStyle = existingStyle
      .replace(/(?:^|;)\s*(width|max-width|height)\s*:[^;]*/gi, '')
      .trim();

    const mergedStyle = `${cleanedStyle}${cleanedStyle ? '; ' : ''}width: 100%; max-width: 100%; height: auto;`;

    if (styleMatch) {
      return `<img${withoutWidth.replace(/style\s*=\s*(["'])(.*?)\1/i, `style="${mergedStyle}"`)}>`;
    }

    return `<img${withoutWidth} style="${mergedStyle}">`;
  });
};

export default function MitigationInstruction({ instruction }: Props) {
  const { width } = useWindowDimensions();
  const contentWidth = Math.max(180, width - 120);
  const normalized = (instruction || '').trim();

  const preparedHtml = useMemo(() => {
    if (!normalized) return '';
    if (hasHtmlMarkup(normalized)) {
      return enforceResponsiveImages(absolutizeInstructionImages(normalized));
    }
    const escaped = normalized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    return `<p>${escaped}</p>`;
  }, [normalized]);

  if (!preparedHtml) {
    return <Text style={{ color: '#475569', lineHeight: 21 }}>No instruction available.</Text>;
  }

  return (
    <View style={styles.wrapper}>
      <RenderHtml
        source={{ html: preparedHtml }}
        contentWidth={contentWidth}
        renderersProps={{
          img: {
            enableExperimentalPercentWidth: true,
          },
        }}
        baseStyle={{ color: '#475569', fontSize: 14, lineHeight: 21 }}
        tagsStyles={{
          p: { marginTop: 0, marginBottom: 8 },
          ul: { marginTop: 4, marginBottom: 8, paddingLeft: 18 },
          ol: { marginTop: 4, marginBottom: 8, paddingLeft: 18 },
          li: { marginBottom: 4 },
          strong: { color: '#0f172a', fontWeight: '700' },
          b: { color: '#0f172a', fontWeight: '700' },
          img: {
            marginTop: 8,
            marginBottom: 8,
            borderRadius: 8,
            width: contentWidth - 8,
            maxWidth: contentWidth - 8,
            height: 'auto',
            alignSelf: 'center',
          },
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    overflow: 'hidden',
  },
});
