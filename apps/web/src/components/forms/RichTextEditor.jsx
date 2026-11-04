import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Code, Heading2, Heading3, Italic, Link2, List, ListOrdered, Quote, Redo2, Strikethrough, Underline, Undo2 } from 'lucide-react';
import { cn } from '../../utils/cn.js';

function ToolButton({ onClick, active, label, icon: Icon, disabled }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} title={label}
      className={cn('grid size-8 place-items-center rounded text-fg-2 hover:bg-surface-2 disabled:opacity-40', active && 'bg-primary-50 text-primary-700')}>
      <Icon className="size-4" />
    </button>
  );
}

/**
 * TipTap editor producing ProseMirror JSON. Only formatting the server allow-lists is
 * offered (no images/HTML), so whatever users create validates and renders safely.
 */
export function RichTextEditor({ value, onChange, label, placeholder = 'Start writing…', error, minHeight = 180 }) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2, 3, 4] }, link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'], HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } } })],
    content: value ?? '',
    editorProps: { attributes: { class: 'prose-content focus:outline-none px-3 py-2', 'aria-label': label ?? 'Rich text editor', 'data-placeholder': placeholder } },
    onUpdate: ({ editor: e }) => onChange?.(e.isEmpty ? null : e.getJSON()),
  });

  useEffect(() => {
    if (editor && value && JSON.stringify(value) !== JSON.stringify(editor.getJSON())) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;
  const setLink = () => {
    const prev = editor.getAttributes('link').href;
    const url = window.prompt('Link URL (https://…)', prev ?? 'https://');
    if (url === null) return;
    if (!url) return editor.chain().focus().unsetLink().run();
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return window.alert('Links must start with https://, http:// or mailto:');
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };
  const c = () => editor.chain().focus();

  return (
    <div className="space-y-1.5">
      {label && <p className="text-sm font-medium text-fg-2">{label}</p>}
      <div className={cn('rounded-md border bg-surface shadow-xs focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-200', error ? 'border-red-500' : 'border-line')}>
        <div className="flex flex-wrap gap-0.5 border-b border-line p-1" role="toolbar" aria-label="Formatting">
          <ToolButton label="Bold" icon={Bold} active={editor.isActive('bold')} onClick={() => c().toggleBold().run()} />
          <ToolButton label="Italic" icon={Italic} active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()} />
          <ToolButton label="Underline" icon={Underline} active={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()} />
          <ToolButton label="Strikethrough" icon={Strikethrough} active={editor.isActive('strike')} onClick={() => c().toggleStrike().run()} />
          <ToolButton label="Heading" icon={Heading2} active={editor.isActive('heading', { level: 2 })} onClick={() => c().toggleHeading({ level: 2 }).run()} />
          <ToolButton label="Subheading" icon={Heading3} active={editor.isActive('heading', { level: 3 })} onClick={() => c().toggleHeading({ level: 3 }).run()} />
          <ToolButton label="Bulleted list" icon={List} active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()} />
          <ToolButton label="Numbered list" icon={ListOrdered} active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()} />
          <ToolButton label="Quote" icon={Quote} active={editor.isActive('blockquote')} onClick={() => c().toggleBlockquote().run()} />
          <ToolButton label="Code block" icon={Code} active={editor.isActive('codeBlock')} onClick={() => c().toggleCodeBlock().run()} />
          <ToolButton label="Link" icon={Link2} active={editor.isActive('link')} onClick={setLink} />
          <span className="mx-1 w-px bg-line" />
          <ToolButton label="Undo" icon={Undo2} disabled={!editor.can().undo()} onClick={() => c().undo().run()} />
          <ToolButton label="Redo" icon={Redo2} disabled={!editor.can().redo()} onClick={() => c().redo().run()} />
        </div>
        <EditorContent editor={editor} style={{ minHeight }} />
      </div>
      {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
