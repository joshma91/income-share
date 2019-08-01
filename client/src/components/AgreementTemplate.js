import React from "react";
import { APIClient, Openlaw } from "openlaw";
import { Container, Loader, Button, Message } from "semantic-ui-react";
import "semantic-ui-css/semantic.min.css";
import "openlaw-elements/dist/openlaw-elements.min.css";
import OpenLawForm from "openlaw-elements";
import AgreementPreview from "./AgreementPreview";
import pcTokenJSON from "../contracts/ProofClaim.json";
import { getTokenContracts } from "../utils/helpers";
import IPFS from "ipfs-http-client";
require("dotenv").config();
const ipfs = new IPFS({
  host: "ipfs.infura.io",
  port: 5001,
  protocol: "https"
});

class AgreementTemplate extends React.Component {
  //initial state of variables for Assignment Template, and web3,etc
  state = {
    // Variables for OpenLaw API
    openLawConfig: null,
    templateName: null,

    // State variables for OpenLaw
    title: "",
    template: "",
    compiledTemplate: null,
    parameters: {},
    executionResult: null,
    variables: null,
    draftId: "",

    // State variables for preview component
    previewHTML: null,
    loading: false,
    ipfsLoading: false,
    ipfsHash: null,
    success: false
  };

  fileInputRef = React.createRef();
  componentDidMount = async () => {
    //create config
    const openLawConfig = {
      server: process.env.URL,
      templateName: this.props.templateName,
      userName: process.env.OPENLAW_USER,
      password: process.env.OPENLAW_PASSWORD
    };

    const apiClient = new APIClient(openLawConfig.server);

    console.log(openLawConfig.userName);
    //const { web3, accounts, contract } = this.props;
    //create an instance of the API client with url as parameter
    apiClient
      .login(openLawConfig.userName, openLawConfig.password)
      .then(console.log);

    //Retrieve your OpenLaw template by name, use async/await
    const template = await apiClient.getTemplate(openLawConfig.templateName);
    console.log(template);

    //pull properties off of JSON and make into variables
    const title = template.title;

    //Retreive the OpenLaw Template, including MarkDown
    const content = template.content;
    console.log("template..", template);

    //Get the most recent version of the OpenLaw API Tutorial Template
    const versions = await apiClient.getTemplateVersions(
      openLawConfig.templateName,
      20,
      1
    );
    console.log("versions..", versions[0], versions.length);

    //Get my compiled Template, for use in rendering the HTML in previewTemplate
    const compiledTemplate = await Openlaw.compileTemplate(content);
    if (compiledTemplate.isError) {
      throw "template error" + compiledTemplate.errorMessage;
    }
    console.log("my compiled template..", compiledTemplate);

    const parameters = {};
    const { executionResult, errorMessage } = await Openlaw.execute(
      compiledTemplate.compiledTemplate,
      {},
      parameters
    );

    console.log("execution result:", executionResult);

    // ** This is helpful for logging in development, or throwing exceptions at runtime.
    if (errorMessage) {
      console.error("Openlaw Execution Error:", errorMessage);
    }

    const variables = await Openlaw.getExecutedVariables(executionResult, {});
    console.log("variables:", variables);

    this.setState({
      openLawConfig,
      apiClient,
      title,
      template,
      compiledTemplate,
      parameters,
      executionResult,
      variables
    });
  };

  onChange = (key, value) => {
    const { compiledTemplate } = this.state;
    console.log(key);
    const parameters = key
      ? {
          ...this.state.parameters,
          [key]: [key].includes("Email")
            ? JSON.stringify({ email: value })
            : value
        }
      : this.state.parameters;

    const { executionResult, errorMessage } = Openlaw.execute(
      compiledTemplate.compiledTemplate,
      {},
      parameters
    );
    const variables = Openlaw.getExecutedVariables(executionResult, {});
    this.setState({ parameters, variables, executionResult });
  };

  setTemplatePreview = async () => {
    const { parameters, compiledTemplate } = this.state;
    console.log(parameters);

    const executionResult = await Openlaw.execute(
      compiledTemplate.compiledTemplate,
      {},
      parameters
    );
    const agreements = await Openlaw.getAgreements(
      executionResult.executionResult
    );
    const previewHTML = await Openlaw.renderForReview(
      agreements[0].agreement,
      {}
    );
    await this.setState({ previewHTML });
    document.getElementById("preview").scrollIntoView({
      behavior: "smooth"
    });
  };

  buildOpenLawParamsObj = async template => {
    const { parameters } = this.state;

    const object = {
      templateId: template.id,
      title: template.title,
      text: template.content,
      creator: process.env.OPENLAW_ID,
      parameters,
      overriddenParagraphs: {},
      agreements: {},
      readonlyEmails: [],
      editEmails: [],
      draftId: ""
    };
    return object;
  };

  onSubmit = async () => {
    const { openLawConfig, apiClient } = this.state;
    try {
      //login to api
      this.setState({ loading: true }, async () => {
        const { accounts, contract } = this.props;
        const token = await apiClient.login(
          openLawConfig.userName,
          openLawConfig.password
        );
        const OPENLAW_JWT = token.headers.openlaw_jwt;

        //add Open Law params to be uploaded
        const uploadParams = await this.buildOpenLawParamsObj(
          this.state.template
        );
        console.log("parmeters from user..", uploadParams.parameters);
        console.log("all parameters uploading...", uploadParams);

        const contractId = await apiClient.uploadContract(uploadParams);
        console.log(contractId);

        await apiClient.sendContract([], [], contractId);

        const pdfURL = process.env.URL + "/contract/pdf/" + contractId;

        console.log(pdfURL);
        const res = await fetch(pdfURL, {
          method: "get",
          headers: new Headers({
            OPENLAW_JWT
          })
        });
        const blob = await res.blob();
        const reader = new window.FileReader();
        reader.readAsArrayBuffer(blob);
        reader.onloadend = async () => {
          const buffer = await Buffer.from(reader.result);
          const ipfsHash = await ipfs.add(buffer);
          console.log("IPFS Hash: ", ipfsHash[0].hash);

          const tokenContracts = await getTokenContracts(accounts, contract);

          console.log("token contracts", tokenContracts);

          const ownedTokens = await this.getOwnedTokens(tokenContracts);
          // Array of tokens owned by account[0]
          console.log("acct0 owned tokens:", ownedTokens);

          await this.setState({
            loading: false,
            success: true,
            draftId,
            ipfsHash: ipfsHash[0].hash
          });
          document.getElementById("success").scrollIntoView({
            behavior: "smooth"
          });
        };
      });
    } catch (error) {
      console.log(error);
    }
  };

  fileChange = async event => {
    event.stopPropagation();
    event.preventDefault();
    const file = event.target.files[0];
    let reader = new window.FileReader();
    reader.readAsArrayBuffer(file);
    reader.onloadend = () => this.convertToBuffer(reader);
  };

  convertToBuffer = async reader => {
    this.setState({ ipfsLoading: true }, async () => {
      //file is converted to a buffer for upload to IPFS
      const buffer = await Buffer.from(reader.result);
      //set this buffer -using es6 syntax
      const ipfsRes = await ipfs.add(buffer);
      console.log(ipfsRes[0].hash);
      this.setState({ ipfsLoading: false });
    });
  };

  getOwnedTokens = async tokenContracts => {
    const { accounts } = this.props;
    // Object which shows all the owners for each token: {address => address[]}
    const ownershipByTokenPromises = tokenContracts.map(async curr => {
      const uniqueAddresses = await this.getAddresesByToken(curr);
      return { [curr]: uniqueAddresses };
    });

    const ownershipByToken = await Promise.all(ownershipByTokenPromises);

    const ownedTokens = ownershipByToken.map(tokenOwnership => {
      const token = Object.keys(tokenOwnership);
      return tokenOwnership[token].includes(
        this.state.parameters["Company EthAddress"]
      )
        ? token[0]
        : null;
    });
    return ownedTokens;
  };

  getAddresesByToken = async tokenAddr => {
    const { web3 } = this.props;
    const instance = new web3.eth.Contract(pcTokenJSON.abi, tokenAddr);
    const transferEvents = await instance.getPastEvents("Transfer", {
      fromBlock: 0,
      toBlock: "latest"
    });

    const addresses = transferEvents
      .map(curr => {
        return [curr.returnValues.from, curr.returnValues.to];
      })
      .reduce((acc, curr) => acc.concat(curr), [])
      .reduce((acc, curr) => {
        if (web3.utils.toBN(curr).isZero()) return acc;
        if (acc.indexOf(curr) < 0) acc.push(curr);
        return acc;
      }, []);

    return addresses;
  };

  render() {
    const {
      apiClient,
      variables,
      parameters,
      executionResult,
      previewHTML,
      loading,
      success,
      ipfsHash,
      ipfsLoading
    } = this.state;
    if (!executionResult) return <Loader active />;
    return (
      <Container text style={{ marginTop: "2em" }}>
        <h1>{this.props.title}</h1>
        <OpenLawForm
          apiClient={apiClient}
          executionResult={executionResult}
          parameters={parameters}
          onChangeFunction={this.onChange}
          openLaw={Openlaw}
          variables={variables}
        />
        <div className="button-group">
          <Button onClick={this.setTemplatePreview}>Preview</Button>
          <Button primary loading={loading} onClick={this.onSubmit}>
            Submit
          </Button>
          <Button
            content="Upload to IPFS"
            labelPosition="left"
            icon="file"
            loading={ipfsLoading}
            onClick={() => this.fileInputRef.current.click()}
          />
          <input
            ref={this.fileInputRef}
            type="file"
            hidden
            onChange={this.fileChange}
          />
        </div>

        <Message
          style={success ? { display: "block" } : { display: "none" }}
          className="success-message"
          positive
          id="success"
        >
          <Message.Header>Submission Successful</Message.Header>
          <p>
            Check your <b>e-mail</b> to sign contract
          </p>
          <p>
            Contract uploaded to IPFS{" "}
            <a target="_blank" href={`http://ipfs.io/ipfs/${ipfsHash}`}>
              <b>here</b>
            </a>
          </p>
        </Message>
        <AgreementPreview id="preview" previewHTML={previewHTML} />
      </Container>
    );
  }
}

export default AgreementTemplate;
