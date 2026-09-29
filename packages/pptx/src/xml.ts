// The XML a .pptx is made of.
//
// OOXML is written by hand here rather than through a library, for the same
// reason the PDF is: the value of this output is that the shapes arrive as
// shapes, and that means deciding exactly which presets and which properties
// are emitted. A library that draws pictures into slides would defeat the
// point of the format.

import { SLIDE } from './model.js';

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** `#1c1f24` or a token that never resolved, as OOXML's six hex digits. */
export function hex(colour: string | undefined, fallback: string): string {
  const found = /^#?([0-9a-f]{6})$/i.exec((colour ?? '').trim());
  if (found) return found[1]!.toUpperCase();
  const short = /^#?([0-9a-f]{3})$/i.exec((colour ?? '').trim());
  if (short) return [...short[1]!].map(c => c + c).join('').toUpperCase();
  return fallback;
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
  + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  + ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

export const CONTENT_TYPES = (slides: number, media: readonly string[]): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${[...new Set(media.map(name => name.slice(name.lastIndexOf('.') + 1)))]
    .map(extension => `<Default Extension="${extension}" ContentType="image/${extension === 'jpg' ? 'jpeg' : extension}"/>`)
    .join('')}
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${range(slides).map(i => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}
</Types>`;

export const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

export const PRESENTATION = (slides: number): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS}>
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${range(slides)
    .map(i => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="${SLIDE.width}" cy="${SLIDE.height}"/>
<p:notesSz cx="${SLIDE.height}" cy="${SLIDE.width}"/>
</p:presentation>`;

export const PRESENTATION_RELS = (slides: number): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${range(slides).map(i => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${slides + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`;

/** An empty master. The layouts a theme provides come later; see pptx-model §5. */
export const SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${NS}>
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr/>
</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`;

export const SLIDE_MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

export const SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${NS} type="blank" preserve="1">
<p:cSld name="白紙"><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr/>
</p:spTree></p:cSld>
<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>
</p:sldLayout>`;

export const SLIDE_LAYOUT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

/** The font a theme names, as OOXML's minor/major pair. */
export const THEME = (heading: string, body: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="DocPresenter">
<a:themeElements>
<a:clrScheme name="DocPresenter">
<a:dk1><a:srgbClr val="1C1F24"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="3A4048"/></a:dk2><a:lt2><a:srgbClr val="F7F8FA"/></a:lt2>
<a:accent1><a:srgbClr val="1F5FA8"/></a:accent1><a:accent2><a:srgbClr val="8A5A00"/></a:accent2>
<a:accent3><a:srgbClr val="767C85"/></a:accent3><a:accent4><a:srgbClr val="B3261E"/></a:accent4>
<a:accent5><a:srgbClr val="2D3138"/></a:accent5><a:accent6><a:srgbClr val="7A7F87"/></a:accent6>
<a:hlink><a:srgbClr val="1F5FA8"/></a:hlink><a:folHlink><a:srgbClr val="6B7280"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="DocPresenter">
<a:majorFont><a:latin typeface="${escapeXml(heading)}"/><a:ea typeface="${escapeXml(heading)}"/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="${escapeXml(body)}"/><a:ea typeface="${escapeXml(body)}"/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="DocPresenter">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>`;

export function slideRels(media: readonly { id: number; target: string }[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
${media.map(one => `<Relationship Id="rId${one.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${one.target}"/>`).join('')}
</Relationships>`;
}

export function slideXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}>
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr/>
${body}
</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function range(count: number): number[] {
  return [...Array(count).keys()];
}

export { range };
