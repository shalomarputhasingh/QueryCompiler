/** EBNF of the supported SQL subset. Mirrored in README.md and docs/sql-grammar.md. */
export const GRAMMAR = `statement     = select_stmt [ ";" ] EOF ;

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
                "(" ( "*" | [ "DISTINCT" ] expr ) ")" ;`;

export const UNSUPPORTED: readonly string[] = [
  "LEFT / RIGHT / FULL / CROSS / NATURAL joins, JOIN ... USING and comma-separated tables",
  "Subqueries, WITH (CTEs), EXISTS, ANY / ALL",
  "UNION, INTERSECT, EXCEPT",
  "CASE expressions, CAST, window functions, scalar functions other than the five aggregates",
  "Positional references (ORDER BY 1) and expressions in LIMIT / OFFSET",
  "Parameters (?, :name) in the SQL text",
  "INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH, PRAGMA and every other non-SELECT statement",
  "More than one statement per request",
  "Integer literals beyond ±9,007,199,254,740,991 (exact JavaScript integers)",
];

export const LIMITATIONS: readonly string[] = [
  "Educational subset of SQL, not a SQL-standard or full SQLite implementation.",
  "Optimizer is rule-based and heuristic: it does not use statistics or a cost model, and rewritten plans are not claimed to be faster.",
  "Execution is checked for equivalence on the sample database in tests; it is not a formal proof of equivalence for arbitrary data.",
  "better-sqlite3 is synchronous, so a running statement cannot be interrupted. Protection comes from the tiny dataset, the compiler rejecting unsupported constructs, a 500-row cap and a duration check while iterating rows.",
  "SQLite files need a writable, persistent file system. On read-only or serverless hosts the app falls back to a seeded in-memory database (changes never persist, which is fine because the database is read-only).",
  "String comparison constant folding is limited to ASCII ordering; LIKE is never folded.",
];
