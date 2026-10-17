# SQL grammar

The supported language is a deliberately small, documented subset of SQL. Anything outside it is rejected with a diagnostic.

```ebnf
statement     = select_stmt [ ";" ] EOF ;

select_stmt   = "SELECT" [ "DISTINCT" ] select_list
                "FROM" table_ref { join }
                [ "WHERE" expr ]
                [ "GROUP" "BY" expr { "," expr } ]
                [ "HAVING" expr ]
                [ "ORDER" "BY" order_item { "," order_item } ]
                [ "LIMIT" integer [ "OFFSET" integer ] ] ;

select_list   = "*" | select_item { "," select_item } ;
select_item   = identifier "." "*"
              | expr [ [ "AS" ] identifier ] ;
table_ref     = identifier [ [ "AS" ] identifier ] ;
join          = [ "INNER" ] "JOIN" table_ref "ON" expr ;
order_item    = expr [ "ASC" | "DESC" ] ;

expr          = or_expr ;
or_expr       = and_expr { "OR" and_expr } ;
and_expr      = not_expr { "AND" not_expr } ;
not_expr      = "NOT" not_expr | predicate ;
predicate     = additive [ comp_op additive
                         | "IS" [ "NOT" ] "NULL"
                         | [ "NOT" ] "LIKE" additive
                         | [ "NOT" ] "BETWEEN" additive "AND" additive
                         | [ "NOT" ] "IN" "(" expr { "," expr } ")" ] ;
comp_op       = "=" | "<>" | "!=" | "<" | "<=" | ">" | ">=" ;
additive      = term { ( "+" | "-" ) term } ;
term          = unary { ( "*" | "/" | "%" ) unary } ;
unary         = ( "-" | "+" ) unary | primary ;
primary       = number | string | "NULL" | "TRUE" | "FALSE"
              | [ identifier "." ] identifier
              | function_call
              | "(" expr ")" ;
function_call = ( "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" )
                "(" ( "*" | [ "DISTINCT" ] expr ) ")" ;
```

## Lexical rules
- Keywords are case-insensitive; identifiers `[A-Za-z_][A-Za-z0-9_]*` (and non-ASCII letters); quoted identifiers use `"…"` or `` `…` ``.
- Numbers: `42`, `3.14`, `.5`, `1e3`. Integer literals must fit in ±9,007,199,254,740,991. `12abc` is an error.
- Strings: `'text'` with `''` for a quote. Unterminated strings stop at the end of the line.
- Operators: `= <> != < <= > >= + - * / %`. Punctuation: `( ) , . ;`.
- Comments: `-- to end of line` and `/* block */`.

## Semantics worth knowing
- `WHERE`, `HAVING` and `ON` need boolean expressions; `AND/OR/NOT` need boolean operands.
- Comparison operands must both be numeric or both TEXT (NULL is compatible with everything and compares to NULL).
- `+ - * /` need numeric operands; `%` needs integers; `/` on two integers truncates.
- `COUNT(*)`, `COUNT([DISTINCT] x)`, `SUM`, `AVG` (numeric only), `MIN`, `MAX`. Aggregates are not allowed in `WHERE`, `ON` or `GROUP BY` and cannot nest.
- With `GROUP BY` or an aggregate, every selected / HAVING / ORDER BY column must be grouped or aggregated; `SELECT *` is not allowed.
- `ORDER BY` may use a select alias; with `DISTINCT` its expressions must be in the select list. Positional references are rejected.
- A table given an alias must be referred to by that alias. Self-joins need aliases. A join's `ON` may only use tables declared up to that join.

## Not supported
- LEFT / RIGHT / FULL / CROSS / NATURAL joins, JOIN ... USING and comma-separated tables
- Subqueries, WITH (CTEs), EXISTS, ANY / ALL
- UNION, INTERSECT, EXCEPT
- CASE expressions, CAST, window functions, scalar functions other than the five aggregates
- Positional references (ORDER BY 1) and expressions in LIMIT / OFFSET
- Parameters (?, :name) in the SQL text
- INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH, PRAGMA and every other non-SELECT statement
- More than one statement per request
- Integer literals beyond ±9,007,199,254,740,991 (exact JavaScript integers)

## Diagnostic codes
`QC1xxx` lexical · `QC2xxx` syntax · `QC3xxx` semantic · `QC9000` internal. Every diagnostic has severity, message, phase, line/column range and often a hint.
