-- Set every table to the full measure, its columns sized by what they hold.
--
-- Once any line of a pipe table runs past 72 characters, pandoc takes the relative
-- column widths from the dashes in the separator line. Authors write `| --- |` or
-- `| ------ |` without thinking of it as a layout, so a prose column can come out a
-- tenth of the page wide and wrap one word to a line. A table with no line that long
-- gets no widths at all and is set at its natural width, centred, narrower than the
-- tables around it.
--
-- Instead each column gets a share of the full width in proportion to the text it
-- holds, header included, so the columns fill at an even rate. It never drops below
-- the width of its longest word, so a short label column is not broken mid-word.
--
-- Runs for both formats: the EPUB carries the same widths as `<col>` percentages.

-- Characters across the text block at the table's type size, less cell padding. Set
-- for bold, which the label columns that most need the floor are written in.
local LINE = 75

local function measure(rows, totals, longest)
  for _, row in ipairs(rows) do
    for i, cell in ipairs(row.cells) do
      local text = pandoc.utils.stringify(cell.contents)
      totals[i] = totals[i] + pandoc.text.len(text)
      for word in text:gmatch("%S+") do
        longest[i] = math.max(longest[i], pandoc.text.len(word))
      end
    end
  end
end

function Table(tbl)
  local count = #tbl.colspecs
  local totals, longest = {}, {}
  for i = 1, count do
    totals[i], longest[i] = 0, 0
  end
  measure(tbl.head.rows, totals, longest)
  for _, body in ipairs(tbl.bodies) do
    measure(body.head, totals, longest)
    measure(body.body, totals, longest)
  end
  local sum = 0
  for i = 1, count do
    sum = sum + totals[i]
  end
  if sum == 0 then
    return nil
  end
  local widths, scale = {}, 0
  for i = 1, count do
    widths[i] = math.max(totals[i] / sum, longest[i] / LINE)
    scale = scale + widths[i]
  end
  for i = 1, count do
    tbl.colspecs[i][2] = widths[i] / scale
  end
  return tbl
end
