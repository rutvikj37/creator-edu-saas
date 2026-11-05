import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';

/** Read-only renderer for stored ProseMirror JSON (same schema as the editor, no raw HTML). */
export function RichTextView({ value, className = '' }) {
  const editor = useEditor({
    editable: false,
    extensions: [StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } } })],
    content: value ?? '',
    editorProps: { attributes: { class: `prose-content ${className}` } },
  });
  useEffect(() => {
    if (editor && value) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);
  if (!value) return null;
  return <EditorContent editor={editor} />;
}
