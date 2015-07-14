#!/usr/local/bin/node

//(c) 2013-2015 mPlane Consortium (http://www.ict-mplane.eu)
// Author: Fabrizio Invernizzi <fabrizio.invernizzi@telecomitalia.it>
//
//                                  
//Redistribution and use in source and binary forms, with or without
//modification, are permitted provided that the following conditions are met:
//1. Redistributions of source code must retain the above copyright
//   notice, this list of conditions and the following disclaimer.
//2. Redistributions in binary form must reproduce the above copyright
//   notice, this list of conditions and the following disclaimer in the
//   documentation and/or other materials provided with the distribution.
//3. All advertising materials mentioning features or use of this software
//   must display the following acknowledgement:
//   This product includes software developed by the <organization>.
//4. Neither the name of the <organization> nor the
//   names of its contributors may be used to endorse or promote products
//   derived from this software without specific prior written permission.
//
//THIS SOFTWARE IS PROVIDED BY <COPYRIGHT HOLDER> ''AS IS'' AND ANY
//EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
//WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
//DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
//DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
//(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
//LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
//ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
//(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
//SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

//=============================================================================
//
//
// DATI mPlane Proxy
//
// Agent per presentare i dati all'interfaccia WEB.
// fabrizio.invernizzi@telecomitalia.it
//
// Telecom Italia 2015
//
//==============================================================================

// PM2 route analytics
require('pmx').init();


var http = require("http"),
    https = require("https"),
	//auth = require('http-auth'),
	path = require('path'),
	url = require('url'),
	cli = require('cli').enable('status','catchall','status'),
	fs = require('fs'),
	_ = require('lodash'),
	util = require('util'),
	EventEmitter = require('events').EventEmitter,
	//os = require('os'),
	anyDB = require('any-db'),
	mplane = require('mplane'),
	async = require('async'),
	supervisor = require("mplane_http_transport");



// Configurazioni varie. 
var DEFAULT_CONFIG = "./agent.json";

// Prevent the perdioci running if true
var working=false;

// Funzioni che sono esposte come API
// Questo array e utile internamente per avere un riferimento ogni volta che devo fare una operazione su tutte le funzioni
// ===>>> Aggiungendo una nuova funzione qui viene automaticamente cercata e caricata dai file di configurazione!!! Serve solo chiamarla nel punto dove deve essere eseguita
var API = ["presentationFunction" , "rowElaborationFunction" ,"referencePeriodFromFileFunction" , "postElaborationFunction" , "preElaborationFunction" , "rowXMapFunction"];

// Lettura delle configurazioni di default 
// configuration contiene sia i parametri si le funzioni che eseguiranno le API
var dataConfig = fs.readFileSync(DEFAULT_CONFIG) , configuration={'params': {},
																  'functions' : {}};



/***************************************************************************************
    mPlane
 ***************************************************************************************/

// We map the specification link for each capability a push to the supervisor
// This will help me in understanding which capability i am receiving a specification for
// Here we put all the info we need to know what to do when we receive a specification
var capabilitiesToSpecifications = {};
// Internal info about my caabilities. For example the registry type, and other
var myCapabilitiesInfo = {};

try {
	configuration.params = JSON.parse(dataConfig);
}
catch (err) {
	cli.debug('There has been an error parsing the JSON DEFAULT configuration FILE.( '+DEFAULT_CONFIG+')');
	console.log(err);
}


// FIXME: put this in a cli param
var CA_FILE = configuration.params.ssl.ca;
var KEY_FILE = configuration.params.ssl.key;
var CERT_FILE = configuration.params.ssl.ca;
var connected = false;
var capabilities = null;
// Syslog 
var Syslog = require('node-syslog');

// Measures for this probe. It is only for semplicity and clarity of coding
var availableMeasures = _.keys( configuration.params.mplane.measureToQuery );

cli.setApp("DATI agent", configuration.params.version)

// TODO: add the possility to configure the supervisor detail from cli
cli.parse({
   mode:  ['m', 'Mode (Daemon: acts as a web server | proxy: mPlane proxy)', 'string', 'proxy']
});
cli.main(function(args, options) {
    DATIProxy();
});


function DATIProxy(){
    capabilities = DATICapability("");
	// Capability push to supervisor
    // When done, calls the pull function
	pushCapPullSpec(capabilities);
}
var recheck = setInterval(function(){
    if (!connected){
        console.log("Supervisor unreachable. Retry in "+configuration.params.mplane.retryConnect/1000 + " seconds...");
        pushCapPullSpec(capabilities);
    }else{
        console.log("------------------------------");
        console.log("");
        console.log("Checking for Specifications...");
        console.log("");
        console.log("------------------------------");
        clearInterval(recheck);
    }
} , configuration.params.mplane.retryConnect);

function pushCapPullSpec(capabilities){
    console.log("***************************");
    console.log("REGISTERING MY CAPABILITIES");
    console.log("***************************\n");
    supervisor.registerCapabilities(capabilities , {
            host: configuration.params.mplane.supervisor.host
            ,port: configuration.params.mplane.supervisor.port
            ,caFile: configuration.params.ssl.ca
            ,keyFile: configuration.params.ssl.key
            ,certFile: configuration.params.ssl.cert
        },function(err , data){
            if (err){
				cli.debug(err);
                return false;
            }else{
				cli.debug("Correctly registered on "+configuration.params.mplane.supervisor.host);
                connected = true;
                supervisor.checkSpecifications(
                    {
                        host: configuration.params.mplane.supervisor.host
						,port: configuration.params.mplane.supervisor.port
						,caFile: configuration.params.ssl.ca
						,keyFile: configuration.params.ssl.key
						,certFile: configuration.params.ssl.cert
                        ,period: configuration.params.mplane.ceckSpecificationPeriod
                    }
                    ,function(specification , callback){
                        var label = specification.get_label();
                        // FIXME: this MUST be changed!!!
                        specification.set_when("2014-09-29 10:19:26.765203 ... 2014-09-29 10:19:27.767020");
						applyASpecification(specification);
						
                    }, function(err){
                        // For some reason we have no capability registered
                        if (err.message == 428){
                            pushCapPullSpec(capabilities);
                        }
                        else
                            console.log(err);
                    }
                );
                return true;
            }
        }
    );
}

/**
* Creates the capability object of DATI
*
* @param type the type of measure FIXME: at this moment it only announce the TCP delay oneway.
* // NECESSARIO UTILIZZRE NELLA CONFIGURAZIONE lo STESSO id (parameter_name della capability) DEL PARAMETRO mplane, nelle config alpaca
*/
function DATICapability(type){
	// Initialize available primitives from the registry
    mplane.Element.initialize_registry("registry.json");

    var capability = new mplane.Capability();
    // Parameter type MUST match EXACTLY the type in the configuration file
    capability.add_parameter({
        type:"destination.ip4",
        constraints:"0.0.0.0 ... 255.255.255.255"
    }).set_when("now ... future / 1s")
    .add_result_column("delay.tcp.twoway.min")
      .add_result_column("delay.tcp.twoway.max")
      .add_result_column("delay.tcp.twoway.mean")
      .set_metadata_value("System_type","DATI")
      .set_metadata_value("System_version","3.0")
      .set_metadata_value("System_ID",configuration.params.systemID)
	  .set_label("TI DATI");

    // Internal capability registry.
    myCapabilitiesInfo[capability.get_token()] = [];
    myCapabilitiesInfo[capability.get_token()].push("delay.tcp.twoway.min" , "delay.tcp.twoway.max" , "delay.tcp.twoway.mean");
    return [capability];
}

/**********************************************************************
/*	Given a specification, do the magic!
**********************************************************************/
function applyASpecification(spec){
	//var spec = mplane.from_dict(body);
	if (!(spec instanceof mplane.Specification)){
		console.log("We expected a specification!")
		return;
	}
	var measures = spec.result_column_names();
	var res = {};
	var RA = new Agent();
	var i=0;
	var measure = measures[i];
	var startAction = new Date();
	
	// Alpaca parameters filled with params coming from mPlane Specification
	// Be careful in match of param names
	cli.debug("ALPACA PARAMS - SHOULD MATCH SPECIFICATION PARAM NAMES!");
	 _.each(spec.getParameterNames(), function(param){
	 	// In debug mode i write these since param should match the registry name of the param in Specification, or default will be silently used!
	 	cli.debug(param);
		RA.customParams[param] = spec.getParameterValue(param); 
	 });

		RA.on("statusCompleted" , function(oldState){
			logInfo("A status has completed: "+oldState);
			switch(oldState) {
				case "PostElaboration":
					this.normalizeData();// Normalizzazione
					this.status = "dataPresentation";
					// FIXME: If no results?
					res[measure] = RA.data[configuration.params.mplane.measureToQuery[measure].SqlColumnName][1];
					i++;
					measure = measures[i];
					if (i<measures.length){
						this.status = "ConfigRead";
						execFunc = RA.loadStatConfig(configuration.params.mplane.measureToQuery[measure].statId);
						working = true;
						execFunc();
					}
					else{
						this.status = "dataSend";
						this.emitAgentActivity("Everything done, sending data ...");
						spec.set_when(startAction.toISOString() + " ... " + new Date().toISOString());
						postResultToSupervisor( spec, res);
						working = false;
					}
				 break;
				case "ConfigRead":
					this.status = "preElaborationFunction";
					break;
				default:
					logInfo("Status unknown:"+oldState);
			}
		});
		// Handles the specification and produces the stat
		execFunc = RA.loadStatConfig(configuration.params.mplane.measureToQuery[measure].statId);
		working = true;
		// Run the measure
		execFunc();
}

/*
Prepare the result and send it to the supervisor
@param specification the specification we are sending a result for
@param results an obj in the form {paramName:[]}

@param results an obj in the form {resultColumnName:[],...}
 */
function postResultToSupervisor( specification , results) {
    console.log("...... postResultToSupervisor .....");
	supervisor.registerResult(
            specification
            , {
                 host: configuration.params.mplane.supervisor.host
				,port: configuration.params.mplane.supervisor.port
				,caFile: configuration.params.ssl.ca
				,keyFile: configuration.params.ssl.key
				,certFile: configuration.params.ssl.cert
            },
            results
            ,function(err , data){
               
            }
        ); //supervisor.registerResult
}


/* -------------------------------------------------------------------------------------------------------------------
        DATI AGENT

This is (part of) the standard daemon for managing sqlite files
TelecomItalia 2014 - fabrizio.invernizzi@telecomitalia.it

--------------------------------------------------------------------------------------------------------------------- */

var Agent = function(){
    this.statConfig = {'params': {},
        'functions' : {}
    };
    this.data = {};
    this.output = {};
    this.statID = "";// Identificativo della richiesta di statistica generato dal client
    this.params = {}; // Parametrizzazione del file di configurazione
    this.customParams = {}; // Eventuali parametri passati dal utente
    this.queue = null;
}
// Eredita gli eventi
util.inherits(Agent , EventEmitter);

// Reset del Agent
Agent.prototype.inizialize = function(){
   this.statConfig = {'params': {},
        'functions' : {}
    };
    this.data = {};
    this.output = {};
    this.statID = ""; // Identificativo della richiesta di statistica generato dal client
    this.params = {};
    this.customParams = {};
    this.queue = null;
}


// Funzione per estrazione parametri utente
// Le parametrizzazzioni sono nella forma di alpacajs (http://www.alpacajs.org/)
// Ricerca default come valore da impostare di default :>)
Agent.prototype.parseUserParams = function(config){
    var starts = [];
    var ends = [];
    var last = 0;
    var dataConfig = String(config);
    while(last != -1){
        last = dataConfig.indexOf("<%" , last+1);
        if (last != -1)
            starts.push(last)
    }
    last = 0;
    while(last != -1){
        last = dataConfig.indexOf("%>" , last+1);
        if (last != -1)
            ends.push(last)
    }
    // Simple check..
    if (starts.length != ends.length){
        cli.debug("Error in parameters formatting!");
        return false;
    }
    // Rimozione delle configurazioni parametriche
    //  Per adesso setta il default
    var numParam = 0;
    var tempConfig = "";
    var beg = 0;
    // Reset o creazione dei parametri che utente puo modificare
    this.params.schema = {};
    this.params.schema.properties = {};
    this.params.schema.type = "object";
    // http://www.alpacajs.org/
    // Creo direttamente schema e options prendendoli dai vari paramentri configurati, ognuno configurato con il proprio schema e options
    if (!this.params.options){
        this.params.options = { "renderForm":true,
            "form":{
                "buttons": {
                    "submit": {}
                }
            },
            "fields": {}
        }
    }
    var par = this.params; // Parametri per il form Alpaca
    var self = this;
	// Inizializzo i parametri di Alpaca
    starts.forEach(function(startPos){
        var thisParam = JSON.parse(dataConfig.slice(startPos+2 , ends[numParam] - 2));
        if (!thisParam.schema.id)
            thisParam.schema.id = Math.floor(Math.random() * 100) + 1;

        if ((!thisParam.schema.default) || (!thisParam.schema.id)){
            logInfo("--->>> Default value or id not set in param <<<---");
            self.emitAgentActivity("parseUserParams: Default value or id not set in param.");
            return false;
        }

        par.schema.properties[thisParam.schema.id] = thisParam.schema;
        if (thisParam.options)
            par.options.fields[thisParam.schema.id] = thisParam.options;
        // Se ho dei parametri inviati da utente utilizzo quelli, altrimenti il default
        var val = thisParam.schema.default;
        if (self.customParams[thisParam.schema.id]){
            val = self.customParams[thisParam.schema.id];
        }
        tempConfig = tempConfig+dataConfig.slice(beg,startPos)+val;

        beg = ends[numParam]+2;// Il delimimitatore ha 2 caratteri
        numParam = (numParam*1) + 1;
    });


    // Ultimo pezzo della stringa
    tempConfig = tempConfig+dataConfig.slice(beg);

    // Alcuni dettagli per il form
    this.params.title = JSON.parse(tempConfig).view.title || "";
    this.params.options.helper =  JSON.parse(tempConfig).view.subTitle || "";
    return tempConfig;
}

// Notifica il vecchio stato ed il nuovo
Agent.prototype.statusCompleted = function(oldState){
    this.emit("statusCompleted" , oldState );
}

// Presentazione
Agent.prototype.dataPresentation = function(){
    this.emitAgentActivity("Formatting data ...");
    this.output = this.statConfig.functions.presentationFunction(this.data , this.statConfig);
    this.statusCompleted("dataPresentation"); // Emits the status completed event
}

// Invia la risposta al client
Agent.prototype.dataSend = function(specification){
    newStats = {		'request': this.statID,
        'stats': this.output,
        'reqId': this.reqId
    };

    this.emitAgentActivity("Everything done, sending data ...");
    postResultToSupervisor(specification);
    
}

// Invia al client i parametri disponibili  in json
Agent.prototype.userParamsSend = function(stat){
    // Lettura della configurazione
    var statConfigFile = configFileName(stat);
    if (!fs.existsSync(statConfigFile)){
        cli.debug(statConfigFile + " does not exist!");
    }
    var dataConfig = fs.readFileSync(statConfigFile);

    // ----------------------------------------------------------------------------------
    // Parametrizzazione delle configurazioni
    // L'utente puo intervenire su alcuni parametri
    // Le parametrizzazzioni sono nella forma di alpacajs (http://www.alpacajs.org/)
    // Tutto cio che è incluso tra <% %> viene considerato un parametro
    // La consifugrazione data di alpaca viene considerata il valore di default

    var userParams = this.parseUserParams(dataConfig);
    if (!userParams){
        emitServerWorking("Error parsing User custom params",this.socket);
        return;
    }

    this.socket.emit('getParamsConfig', JSON.stringify({
        'request': 'getParamsConfig',
        'id' : stat,
        'config': this.params
    }));
    this.params = {};
}

// Funzione di comodo per le API che devono inviare al browser delle info
Agent.prototype.emitAgentActivity = function(text){
    console.log("... emitAgentActivity: "+ text);
//    emitServerWorking(text,this.socket);
}

// Analizza data e si fa una mappa di tutti i punti/categorie presenti
// Normalizza le serie in modo che i punti mancanti abbiano valore null
// Ipotizza che le serie abbiamo dati gia ORDINATI in base alla x!
// Se il valore è NaN lo setta a null, altrimenti non viene visualizzato il grafico
Agent.prototype.normalizeData = function(){
    this.emitAgentActivity("DISABLED HERE --- Normalizing data ... filling holes");
    return true;
    var seriesIndex = {}; // Indice dei punti presenti
    var series = _.keys(this.data);
    var curData = this.data;
    // Cerco i valori sulle x
    var xPoints = [];
    var RA = this;
    for (num=0 ; num<series.length ; num++){
        this.emitAgentActivity("Normalizing data ... filling holes ("+Math.round((num/series.length)*100)+" %)");
        serie = curData[series[num]];
        if (!seriesIndex[series[num]])
            seriesIndex[series[num]] = [];
        for (i=0 ; i<serie.length ; i++){
            point = curData[series[num]][i];
            seriesIndex[series[num]].push(point[0]);
            if (xPoints.indexOf(point[0]) == -1){
                xPoints.push(point[0]);
            }
        }
    }
    xPoints = _.sortBy(xPoints , function(num){return num;});
    // Verifico che le serie li abbia tutti
    var count = 0;
    xPoints.forEach(function(pointX){
        RA.emitAgentActivity("Normalizing data ... checking points ("+Math.round((count/xPoints.length)*100)+" %)");
        count++;
        for (num=0 ; num<series.length ; num++){
            serie = curData[series[num]];
            if (seriesIndex[series[num]].indexOf(pointX) == -1){
                for (i=0 ; i<serie.length ; i++){
                    point = curData[series[num]][i];
                    // Si ipotizza che i dati nella serie siano ordinati per ascissa,
                    // 	pertanto trovare una x maggiore significa che quella che stiamo cercando non e presente.
                    if (point[0] > pointX){
                        curData[series[num]].splice(i,0,[pointX , null]);
                        i = serie.length;
                    }
                }
            }
        }
    });

    // Pone a null i punti a valore 0 e nulli
    for (num=0 ; num<series.length ; num++){
        RA.emitAgentActivity("Normalizing data ... checking null points ("+Math.round((num/series.length)*100)+" %)");
        serie = curData[series[num]];
        for (i=0 ; i<serie.length ; i++){
            point = curData[series[num]][i];
            // Highchart non digerisce i punti NaN o Infinity
            if ((parseFloat(point[1]) == 0) || isNaN(Number(point[1])) || !isFinite(Number(point[1]))){
                curData[series[num]][i] = [point[0] , null];
            }
        }
    }
    this.data = curData;
}

// ------------------------------------------------------------------------------------
// Mapping delle funzioni
// Include il file con le definizioni delle funzioni
var scriptFile = require(configuration.params.scriptFile);
_.each( API , function(func){
    configuration.functions[func] =  scriptFile[configuration.params[func]];
});
// ------------------------------------------------------------------------------------


// Carica i parametri di configurazione settati nel file di configurazione di una statistica
// Se il file non esiste, non fa nulla
// Sovrascrive solo i parametri indicati nel file specifico
// Restituisce un json con le configurazioni specifiche (quelle di default dove non indicate)
Agent.prototype.loadStatConfig  = function(stat){
    this.statID = stat;
    logInfo("--- LoadConfig:"+this.statID);
    var tmpConfig = {'params': {},
        'functions' : {}};
    var statConfigFile = configFileName(stat);
    var statScriptFile;
    var self = this;

    this.emitAgentActivity("Loading stat configuration");
    // Copia dalla configurazione di default, inizializzazione
    _.each(_.keys(configuration.params), function(param){
        self.statConfig.params[param] = configuration.params[param];
    });
    // Lettura delle funzioni da configurazione
    _.each( API , function(func){
        self.statConfig.functions[func] = configuration.functions[func];
    });

    // Il file di configurazione specifico potrebbe anche non esistere.
    // In questo caso avremo esattamente la configurazione di default
    if (fs.existsSync(statConfigFile)){
        logInfo("Loading Config file " + statConfigFile);
        var dataConfig = fs.readFileSync(statConfigFile);

        // ----------------------------------------------------------------------------------
        // Parametrizzazione delle configurazioni
        // L'utente puo intervenire su alcuni parametri
        // Le parametrizzazzioni sono nella forma di alpacajs (http://www.alpacajs.org/)
        // Tutto cio che è incluso tra <% %> viene considerato un parametro
        // La configurazione data di alpaca viene considerata il valore di default

        dataConfig = this.parseUserParams(dataConfig);
        if (!dataConfig){
            cli.debug("-------------------------------------------------------------------------------------");
            cli.debug('--- There has been an error parsing the JSON configuration FILE.( '+statConfigFile+')');
            console.log(err);
            cli.debug("-------------------------------------------------------------------------------------");
            self.emitAgentActivity("There has been an error parsing the JSON configuration FILE.( "+statConfigFile+")");
        }else{
            // ----------------------------------------------------------------------------------
            try {
                tmpConfig.params = JSON.parse(dataConfig);
            }
            catch (err) {
                cli.debug("-------------------------------------------------------------------------------------");
                cli.debug('--- There has been an error parsing the JSON configuration FILE.( '+statConfigFile+')');
                console.log(err);
                cli.debug("-------------------------------------------------------------------------------------");
                self.emitAgentActivity("There has been an error parsing the JSON configuration FILE.( "+statConfigFile+")");
            }
        }
    }else{
        logInfo("*** "+statConfigFile+" does not exist ***");
    }
    // Lettura delle configurazioni specifiche
    _.each(_.keys(tmpConfig.params), function(param){
        self.statConfig.params[param] = tmpConfig.params[param];
    });

    // Funzioni. Per le funzioni indicate nel file di configurazione specifico,
    // utilizza quelle prese dallo script file specifico
    if (fs.existsSync(tmpConfig.params.scriptFile)){
        statScriptFile = require(tmpConfig.params.scriptFile);
        _.each( API , function(param){
            if (_.has(tmpConfig.params , param)){
                self.statConfig.functions[param] = statScriptFile[tmpConfig.params[param]];
            }
        });
    }else{
        cli.debug("It looks like the script file is not defined or does not exist:"+tmpConfig.params.scriptFile);
    }

    self.statusCompleted("ConfigRead");

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Creo una closure in modo che alla funzione di esecuzione delle query venga associato il contesto corretto.
    return function(){
        self.emitAgentActivity("Preelaboration ...");
        // PreElaborazione
        self.statConfig.functions.preElaborationFunction(self.data , self.statConfig);

        var data = self.data;
        var configuration = self.statConfig;

        //worker con parametri standard
        var queryFunc =  function(file , callback){
            var error = null;
            DBcon = null;
            openDBConnection(configuration.params.dataDir+"/"+file , configuration.functions.referencePeriodFromFileFunction(file) , function(err , DBcon){
                if (err || _.isNull(DBcon) || _.isNull(DBcon.conn) ){
                    logInfo("doQuery - Error connectig to DB "+file);
                    callback(err , file);
                }else
                	
                    DBcon.conn.query(configuration.params.SQL_QUERY , function(err , res){
                        if (err){
                            logInfo("doQuery - Error Opening  doQuery db: "+err);
                            error = err;
                            callback(error , file);
                            return;
                        }
                        if (res === undefined){
                            logInfo("doQuery - Error in the db query. Answer is undefined");
                            callback(null , file);
                            return;
                        }

                        for (var i=0; i<res.rowCount; i++){
                            configuration.functions.rowElaborationFunction(res.rows[i] , data , DBcon , configuration );
                        }
                        // Segnala di aver finito un file
                        DBcon = null;
                        callback(error , file);
                    });
            });
        } //queryFunc

        // CERCA I FILE SQLITE
        // Leggo in modo sincrono i file da analizzare
        try{
            var allFiles = fs.readdirSync(self.statConfig.params.dataDir);
        }catch(e){
            console.log(e);
            self.emitAgentActivity("NO MATCHING FILES FOUND ...");
            self.statusCompleted("PostElaboration"); // Emits the status completed event
            return;
        }
        var files = [];
        // Applica i filtri configurati sui file da considerare.
        // Lo fa prima per far quadrare gli array ed i numeri delle percentuali
        if (allFiles){
            allFiles.forEach(function(file){
                if (self.fileFilter(file)){
                    files.push(file);
                }
            });
        }
        var numOfFile = files.length;
        // Se non ho file da eleborare lo segnalo ed esco
        if (numOfFile <=0){
            self.emitAgentActivity("No file selected for elaboration. Please check your configuration");
            self.statusCompleted("PostElaboration"); // Emits the status completed event
            return;
        }
        var elaborated = 0;
        // Parallelizzazione delle query ai db e successiva collezione dei dati
        self.queue = async.queue(queryFunc , self.statConfig.params.dbReadingMAXConcurrency);

        files.forEach(function(file){
            var errNum = 0;
            //cli.progress(Math.round((elaborated/numOfFile)*100))
            //var textToClient = "Extracting data ("+Math.round((elaborated/numOfFile)*100)+"%)";
            elaborated = (elaborated+1);
            // Verifico che si tratti effettivamente di un file db. Servirebbe una verifica piu approfondita
            if (path.extname(file) == ".db"){
                self.queue.push( file , function(err , result){
                    if (err){
                        errNum += 1;
                        logInfo("DATI_agent - ERROR ON FILE  "+configuration.params.dataDir+"/"+file+" "+err);
                    }
                });
            }
        });

        // Tutti i worker hanno finito
        self.queue.drain = function(){
        	self.emitAgentActivity("Data postelaboration ...");
            // Post elaborazione dei dati letti
            self.statConfig.functions.postElaborationFunction(self.data , self.statConfig , function(){self.statusCompleted("PostElaboration");},self);
            self.statusCompleted("PostElaboration"); // Emits the status completed event
        }
    }// Fine closure
    ///////////////////////////////////////////////////////////////////////////////////////////////
}
// ***********************************************************************************************************************
//		FILE FILTERS
//
// Un filtro è nella forma filterName:paramName=paramValue;paramName=paramValue&filterName:paramName=paramValue;paramName=paramValue
// Per adesso AND tra i filtri
// Filtri implementati
// --- last
//	 	accetta tutti i file creati negli ultimi x giorni, mesi
//		Accetta come parametri uno tra days (numero di giorni), [month (numero di mesi)]

// Funzione di verifica sulla base delle policy configurate di utilizzo di un file.
// Se per la statistica è stata configurata fileFilter applica il filtro.
// @return true se file deve essere utilizzato, false altrimenti
Agent.prototype.fileFilter  = function(file){
    var ret = true;
    var RA = this;
    // Verifica che il file non sia di dimensioni 0
    if (!RA.filterSize(file)){
        cli.debug("File size exclusion");
        return false;
    }
    else
        //cli.debug("---- FILE OK ----");

    if (!this.statConfig.params.fileFilter){
        return true;
    }

    // Parsing del filtro
    var filters = this.statConfig.params.fileFilter.split("&");
    _.each(filters, function(filter){
        // Estrae i parametri
        var splitted = filter.split(":");
        var filterType = splitted[0];
        // Estrazione dei parametri associati al filtro
        var params = {};
        var par = splitted[1].split(";");
        _.each(par, function(param){
            var splitted = param.split("=");
            params[splitted[0]] = splitted[1];
        });
        // Applicazione del filtro
        switch (filterType){
            case "last":
                ret = ret && RA.filterLast(file , params);
                break;
            default:
                cli.debug("Unknown filter type "+filterType);
        }
    });
    return ret;
}

// Filtro per verifica se il file NON è piu vecchio di
// UTILIZZA LA DATA DI CREAZIONE DEL FILE
// Per adesso solo days come parametro
Agent.prototype.filterLast = function(file , params){
    var ret = true;
    var maxAge = (1000 * 60 * 60 * 24 * 365 * 5); // 5 anni
    var created = new Date(fs.lstatSync(this.statConfig.params.dataDir+"/"+file).ctime);
    if (params.days){
        maxAge = (1000 * 60 * 60 * 24 * params.days);
    }
    if ((Date.now() - created) > maxAge)
        ret = false
    return ret;
}
// Verifica che il file non sia vuoto
Agent.prototype.filterSize = function(file){
    if (((fs.statSync(this.statConfig.params.dataDir+"/"+file).size) == 0)){
        cli.debug(this.statConfig.params.dataDir+"/"+file + " size 0");
        return false;
    }else
        return true;
};

// Apertura di una connessione ad un db (file name con full path)
function openDBConnection(file , referencePeriod , callback){
    var conn = {
        conn: null,
        file: file,
        referencePeriod: '',
        dbDriver: null
    };
    if (!file || !fs.existsSync(file) || (file.substr(-8,8) == "-journal")){
        logInfo("openDBConnection - inexistent or not defined file: "+file);
        callback(new Error("Null file") , null);
    }

    conn.dbDriver = 'sqlite3://'+file;
    conn.referencePeriod = referencePeriod;
    var error = null;
    conn.conn = anyDB.createConnection(conn.dbDriver , function(err,data){
        if (err || !data){
            conn.conn = null;
            logInfo("openDBConnection - Error Opening db: "+err);
            error = err;
        }else{
            error = null;
        }
        callback(error , conn);
    });
}

// Sulla base di una statistica, decide quale e il possibile file di configurazione specifico
function configFileName(stat){
    return (configuration.params.configsDir+stat+".config");
}

// ---------------------------------------------------------------------------------------
//
// Syslog utility functions
// ---------------------------------------------------------------------------------------
function logInfo(msg){
    Syslog.init("DATI AGENT", configuration.params.syslogSelector, Syslog.LOG_LOCAL0);
    Syslog.log(Syslog.LOG_INFO, msg);
    cli.debug(msg);
}

// Informazioni di stato dei lavori del server
function emitServerWorking(msg, socket){
    if (socket){
        socket.emit('serverActivity', JSON.stringify({
            system: configuration.params.systemID,
            msg: msg
        }));
    }else{
        cli.debug("Socket is Null ...");
    }
}



