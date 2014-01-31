function ASTManipulator(source)
{
  this.source = source;
  this.ast = null;
  
  this._functions = null;
  this._classes = null;
}

//NODE Identification methods : TODO: expand on this
ASTManipulator.prototype._isNodeAVariableDeclaration = function(node, classes)
{
  if(node.type == 'VariableDeclarator' && node.init && node.init.callee && (node.init.callee.name in classes))
  {
    var instanceName = node.id.name;
    var className = node.init.callee.name;
    console.log("created one instance of", className);
    return true;
  }
  return false;
}

ASTManipulator.prototype._isNodeAFunctionDeclaration = function(node, functions)
{
  if (node.type == 'FunctionExpression' || node.type == 'FunctionDeclaration')
  {
    if(node.id !== null && node.id !== undefined )
    {
      var name = node.id.name;
      functions[name] = {range:node.range};
      //console.log("function",name, "range", node.range, "node",node);
      return true;
    }
  }
  return false;
}

ASTManipulator.prototype._isNodeAClassDeclaration = function(node, classes)
{
  if(node.type=='AssignmentExpression' && node.operator === '='  )
  { 
    //console.log("asignment", node.right.arguments, node);
    //"class detection"
    if(node.left.object && node.left.object.name && node.right.arguments && node.right.arguments.length >0 && node.right.arguments[0].property && node.right.arguments[0].property.name)
    {
      var className = node.left.object.name;
      var isValid = node.right.type == "CallExpression" && node.right.arguments[0].property && node.right.arguments[0].property.name =="prototype"

      if( className in functions && node.left.property.name === "prototype" && isValid)
      {
        var className = node.left.object.name;
        classes[className]={range:functions[className].range};
        return true;
      }
    }
  }
  return false;
}


//MAIN METHODS
ASTManipulator.prototype.generateAst=function(source)
{
  var startTime = new Date();
  try
  {
    var ast = esprima.parse(source,{loc:true, range:true, tolerant:true});
    var scope = escope.analyze(ast);
    //console.log("ast",ast,"scope", scope);
    this.ast = ast;
  }
  catch(error)
  {
      console.log("failed to generate ast:", error.name + ': ' + error.message);
  }
  var endTime = new Date();
  var elapsed = endTime - startTime;
  console.log("AST generation took:"+ elapsed)
}

ASTManipulator.prototype.traverseAst=function()
{
    console.log("traversing ast")
    var functions = {};
    var classes = {};

    var source = this.source;

    estraverse.traverse(this.ast, {
        enter: function (node, parent) {
            //console.log("node",node)
            if (node.type == 'FunctionExpression' || node.type == 'FunctionDeclaration')
            {
              if(node.id !== null && node.id !== undefined )
              {
              var name = node.id.name;
              functions[name] = {range:node.range};
              //console.log("function",name, "range", node.range, "node",node);
              return estraverse.VisitorOption.skip;
              }
            }
            else if(node.type == 'Identifier' && node.name in functions)
            {
              //console.log("blahh",node.name);
            }
            else if(node.type == 'VariableDeclarator' && node.init && node.init.callee && (node.init.callee.name in classes))
            {
              var instanceName = node.id.name;
              var className = node.init.callee.name;
              console.log("created one instance of", className);
              var nodeSrc = source.slice(node.range[0],node.range[1]);
              console.log("node", node, "source", nodeSrc );
              nodeSrc += ";\n"+instanceName+".__meta.foo=42";
              var tempAst = esprima.parse(nodeSrc);
              console.log("tempAst",tempAst);
              //node.replace(tempAst);
              //return tempAst;

            }
            else if(node.type=='AssignmentExpression' && node.operator === '='  )
            { 
              console.log("asignment", node.right.arguments, node);

              //"class detection"
              
              if(node.left.object && node.left.object.name && node.right.arguments && node.right.arguments.length >0 && node.right.arguments[0].property && node.right.arguments[0].property.name)
              {
                var className = node.left.object.name;
                var bla = node.right.type == "CallExpression" && node.right.arguments[0].property && node.right.arguments[0].property.name =="prototype"

                if( className in functions && node.left.property.name === "prototype" && bla)
                {
                  var className = node.left.object.name;
                  //var range = functions[]
                  classes[className]={range:functions[className].range};
                }
              }
            }
        },
        leave: function (node, parent) {
          if (node.type == 'FunctionExpression' || node.type == 'FunctionDeclaration')
              //console.log("leaving function",node);
              return estraverse.VisitorOption.Skip;
            /*if (node.type == 'VariableDeclarator')
              console.log(node.id.name);*/
        }
    });
    console.log("Functions",functions);
    console.log("classes",classes);
    this._classes = classes;
    this._functions = functions;
}


ASTManipulator.prototype.injectTracing= function(source)
{
  //function entry/exit experiments
  functionEntrytracer = esmorph.Tracer.FunctionEntrance(function(fn) {
        var signature;
        console.log("function:",fn,"\n");
        return ""
         /*if (fn.name !== "ctor") {
          return signature = "this.__meta = {\n  lineNumber: " + fn.line + ", \n  range: [ " + fn.range[0] + ", " + fn.range[1] + "]\n}";
        } else {
          return "";
        }*/
      });
  functionEndtracer = esmorph.Tracer.FunctionExit(function(fn) {
        if(fn.name == "[Anonymous]" || fn.name == "__extends") return "";//for coffeescript
        //if (fn.name === "Part") return "";
        var additions = "";
        //instance metadata
        //TODO: cleanup : we don't need could, instances list.length should be enough
        additions += "if(! ('"+fn.name +"' in partInstancesByType)) partInstancesByType['"+fn.name+"']={count:0,instances:[]};\n"; 
        additions += "partInstancesByType['"+fn.name+"'].count+=1;\n";
        additions += "partInstancesByType['"+fn.name+"'].instances.push(this);\n";

        //positional metadata
        additions += "   this.__meta = {\n  lineNumber: " + fn.line + ", \n  range: [ " + fn.range[0] + ", " + fn.range[1] + "]\n}";
        //TODO: add instance tracing
        additions += "";
        return additions;
      });

  var outSource = esmorph.modify(source, [functionEntrytracer, functionEndtracer])
  //console.log("outputSource",outSource);
  return outSource;
}

ASTManipulator.prototype.fallafelTest = function(source)
{
    console.log("fallafel test");
    console.log("functions", this._functions, "classes", this._classes);
    var output = "";

    function isKeyword (id) {
        if (id === 'beep') return true;
    }
    /*
    var src = 'console.log(beep "boop", "BOOP");';
    var output = falafel(src, { isKeyword: isKeyword }, function (node) {
        if (node.type === 'UnaryExpression'
        && node.keyword === 'beep') {
            node.update(
                'String(' + node.argument.source() + ').toUpperCase()'
            );
        }
    });
    */
    /*TWO SEPERATE ASPECTS: (therefore splitable into seperate methods)
      - node identification
      - node alteration
    */
    var functions = this._functions;
    var classes = this._classes;

     var output = falafel(source, {ast:this.ast, isKeyword: isKeyword }, function (node) {
        //console.log("node", node);
        if(node.type == 'VariableDeclaration')
        {
            console.log("var declaration", node);
        }
        if(node.type == 'VariableDeclarator' && node.init && node.init.callee && (node.init.callee.name in classes))
        {
          var instanceName = node.id.name;
          var className = node.init.callee.name;
          console.log("created one instance of", className);
          console.log("node", node);

          var updatedSource = node.source();
          updatedSource += ";\n if(!('instancesData' in "+instanceName+".__meta)){"+instanceName+".__meta.instancesData=[]}"
          updatedSource += ";\n"+instanceName+".__meta.instancesData.push({range: [ " + node.id.range[0] + ", " + node.id.range[1] + "]})\n"

          //instances tracking
          updatedSource += "codeLocToinstances['"+node.id.range[0] + ", " + node.id.range[1]+"']="+ instanceName +";\n";

          console.log("updated source to inject instance tracking", updatedSource);
          node.update(updatedSource);
        }
    });
    console.log("output", output);
    var result = output.toString();
    //console.log("result", result);
    return result;
}
