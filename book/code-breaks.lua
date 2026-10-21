-- Breakpoints inside long inline code, for LaTeX.
--
-- An identifier like iam.disableServiceAccountKeyCreation is one unbreakable word in
-- a monospace font and runs into the margin, and so does a formula like
-- `2^S := {Q : Q ⊆ S}`, because pandoc escapes the spaces inside code as `\ `. The
-- LaTeX writer escapes the code and wraps it in \texttt; this filter takes that
-- output and permits a break after a space, dot, slash, colon, hyphen or underscore,
-- and between a lower- and an upper-case letter, with \allowbreak: TeX breaks there
-- only when it must, and without a hyphen, which is right for code. Short code is
-- left alone.
--
-- Only those spots, and only in pandoc's escaped text, so a break can never land
-- inside an escape such as \textbackslash{}: a macro name is letters only, and none
-- of the rules can match inside one. (seqsplit, which breaks between any two
-- characters, cannot be used: it fails on the `\^{}` pandoc writes for a caret.)

local MIN = 12

function Code(code)
  if FORMAT ~= "latex" or #code.text < MIN then
    return nil
  end
  local tex = pandoc.write(pandoc.Pandoc({ pandoc.Plain({ code }) }), "latex")
  tex = tex:gsub("%s+$", "")
  tex = tex:gsub("\\ ", "\\ \\allowbreak ")
  tex = tex:gsub("\\_", "\\_\\allowbreak ")
  tex = tex:gsub("([./:%-])", "%1\\allowbreak ")
  tex = tex:gsub("(%l)(%u)", "%1\\allowbreak %2")
  return pandoc.RawInline("latex", tex)
end
