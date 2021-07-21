import { default as gql, disableFragmentWarnings } from "graphql-tag";

import {
  printWithReducedWhitespace,
  hideLiterals,
  hideStringAndNumericLiterals
} from "../transforms";

// The gql duplicate fragment warning feature really is just warnings; nothing
// breaks if you turn it off in tests.
disableFragmentWarnings();

describe("printWithReducedWhitespace", () => {
  const cases = [
    {
      name: "lots of whitespace",
      // Note: there's a tab after "tab->", which prettier wants to keep as a
      // literal tab rather than \t.  In the output, there should be a literal
      // backslash-t.
      input: gql`
        query Foo($a: Int) {
          user(
            name: "   tab->	yay"
            other: """
            apple
               bag
            cat
            """
          ) {
            name
          }
        }
      `,
      output:
        'query Foo($a:Int){user(name:"   tab->\\tyay",other:"apple\\n   bag\\ncat"){name}}'
    }
  ];
  cases.forEach(({ name, input, output }) => {
    test(name, () => {
      expect(printWithReducedWhitespace(input)).toEqual(output);
    });
  });
});

describe("hideLiterals", () => {
  const cases = [
    {
      name: "full test",
      input: gql`
        query Foo($b: Int, $a: Boolean) {
          user(
            name: "hello"
            age: 5
            pct: 0.4
            lst: ["a", "b", "c"]
            obj: { a: "a", b: 1 }
          ) {
            ...Bar
            ... on User {
              hello
              bee
            }
            tz
            aliased: name
            withInputs(
              str: "hi"
              int: 2
              flt: 0.3
              lst: ["x", "y", "z"]
              obj: { q: "r", s: 1 }
            )
          }
        }

        fragment Bar on User {
          age @skip(if: $a)
          ...Nested
        }

        fragment Nested on User {
          blah
        }
      `,
      output:
        'query Foo($b:Int,$a:Boolean){user(name:"",age:0,pct:0,lst:[],obj:{}){...Bar...on User{hello bee}tz aliased:name ' +
        'withInputs(str:"",int:0,flt:0,lst:[],obj:{})}}' +
        "fragment Bar on User{age@skip(if:$a)...Nested}fragment Nested on User{blah}"
    }
  ];
  cases.forEach(({ name, input, output }) => {
    test(name, () => {
      expect(printWithReducedWhitespace(hideLiterals(input))).toEqual(output);
    });
  });
});

describe("hideStringAndNumericLiterals", () => {
  const cases = [
    {
      name: "full test",
      input: gql`
        query Foo($b: Int, $a: Boolean) {
          user(
            name: "hello"
            age: 5
            pct: 0.4
            lst: ["a", "b", "c"]
            obj: { a: "a", b: 1 }
          ) {
            ...Bar
            ... on User {
              hello
              bee
            }
            tz
            aliased: name
            withInputs(
              str: "hi"
              int: 2
              flt: 0.3
              lst: ["", "", ""]
              obj: { q: "", s: 0 }
            )
          }
        }

        fragment Bar on User {
          age @skip(if: $a)
          ...Nested
        }

        fragment Nested on User {
          blah
        }
      `,
      output:
        'query Foo($b:Int,$a:Boolean){user(name:"",age:0,pct:0,lst:["","",""],obj:{a:"",b:0}){...Bar...on User{hello bee}tz aliased:name ' +
        'withInputs(str:"",int:0,flt:0,lst:["","",""],obj:{q:"",s:0})}}' +
        "fragment Bar on User{age@skip(if:$a)...Nested}fragment Nested on User{blah}"
    }
  ];
  cases.forEach(({ name, input, output }) => {
    test(name, () => {
      expect(
        printWithReducedWhitespace(hideStringAndNumericLiterals(input))
      ).toEqual(output);
    });
  });
});
