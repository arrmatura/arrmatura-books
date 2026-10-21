-- Put a hairline between the rows of every LaTeX table.
--
-- pandoc's LaTeX writer draws booktabs rules in three places -- above the table,
-- under the header, and at the bottom -- and nothing at all between body rows. This
-- book's tables carry prose in up to four columns, so a single row wraps to three or
-- four lines and, with no rule, one row runs straight into the next.
--
-- It cannot be fixed from the preamble. The row terminator inside a longtable is
-- longtable's own \LT@tabularcr, installed when the environment begins, so patching
-- \\ has no effect and patching \LT@tabularcr breaks the header. What works is to
-- re-render the table through the very same writer and put the rules into the result.
--
-- The rule is written out in full rather than as a preamble macro, so this filter
-- depends on nothing but colortbl, which the build's preamble loads. A quarter black,
-- so a long table reads as banded rather than as a grid.
--
-- Because the table comes back as a raw block, pandoc no longer sees a table in the
-- document and its template stops loading longtable and booktabs -- the build passes
-- `-V tables=true` to keep them.

local RULE = "\\arrayrulecolor{black!25}\\hline\\arrayrulecolor{black}\n"

function Table(tbl)
  if FORMAT ~= "latex" then
    return nil
  end
  local tex = pandoc.write(pandoc.Pandoc({ tbl }), "latex")
  -- Body rows sit between \endlastfoot and \end{longtable}; the header's own rows
  -- are above that and must not be touched.
  local head, body, tail = tex:match("^(.-\\endlastfoot\n)(.-)(\\end{longtable}.*)$")
  if not head then
    return nil
  end
  local rows, position = {}, 1
  while true do
    local _, stop = body:find("\\\\\n", position, true)
    if not stop then
      break
    end
    rows[#rows + 1] = body:sub(position, stop)
    position = stop + 1
  end
  -- One row needs no separator, and concat puts a rule between rows rather than
  -- after the last one, where it would double the \bottomrule.
  if #rows < 2 then
    return nil
  end
  return pandoc.RawBlock(
    "latex",
    head .. table.concat(rows, RULE) .. body:sub(position) .. tail
  )
end
