/**
 * GitHub Projects v2 GraphQL 쿼리 정의
 */

// 조직의 프로젝트 조회
export const GET_ORGANIZATION_PROJECT_V2 = `
  query GetOrganizationProjectV2($owner: String!, $projectNumber: Int!) {
    organization(login: $owner) {
      projectV2(number: $projectNumber) {
        id
        title
        shortDescription
        url
        createdAt
        updatedAt
        closed
        public
      }
    }
  }
`;

// 사용자의 프로젝트 조회
export const GET_USER_PROJECT_V2 = `
  query GetUserProjectV2($owner: String!, $projectNumber: Int!) {
    user(login: $owner) {
      projectV2(number: $projectNumber) {
        id
        title
        shortDescription
        url
        createdAt
        updatedAt
        closed
        public
      }
    }
  }
`;

// 프로젝트의 모든 아이템 조회 (페이지네이션 지원)
export const GET_PROJECT_V2_ITEMS = `
  query GetProjectV2Items($projectId: ID!, $first: Int!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
          totalCount
          nodes {
            id
            type
            content {
              ... on Issue {
                __typename
                id
                number
                title
                state
                url
                body
                repository {
                  owner { login }
                  name
                }
                createdAt
                updatedAt
                assignees(first: 10) {
                  nodes {
                    login
                    name
                  }
                }
                labels(first: 20) {
                  nodes {
                    name
                    color
                  }
                }
                timelineItems(first: 50) {
                  nodes {
                    ... on ConnectedEvent {
                      __typename
                      createdAt
                      subject {
                        ... on PullRequest {
                          __typename
                          url
                          number
                          title
                          state
                        }
                      }
                    }
                    ... on CrossReferencedEvent {
                      __typename
                      createdAt
                      source {
                        ... on PullRequest {
                          __typename
                          url
                          number
                          title
                          state
                        }
                      }
                    }
                  }
                }
              }
              ... on PullRequest {
                __typename
                id
                number
                title
                state
                url
                body
                repository {
                  owner { login }
                  name
                }
                createdAt
                updatedAt
                assignees(first: 10) {
                  nodes {
                    login
                    name
                  }
                }
                labels(first: 20) {
                  nodes {
                    name
                    color
                  }
                }
              }
              ... on DraftIssue {
                __typename
                id
                title
                body
                createdAt
                updatedAt
                assignees(first: 10) {
                  nodes {
                    login
                    name
                  }
                }
              }
            }
            fieldValues(first: 50) {
              nodes {
                ... on ProjectV2ItemFieldTextValue {
                  __typename
                  text
                  field {
                    ... on ProjectV2FieldCommon {
                      name
                    }
                  }
                }
                ... on ProjectV2ItemFieldSingleSelectValue {
                  __typename
                  name
                  optionId
                  field {
                    ... on ProjectV2FieldCommon {
                      name
                    }
                  }
                }
                ... on ProjectV2ItemFieldNumberValue {
                  __typename
                  number
                  field {
                    ... on ProjectV2FieldCommon {
                      name
                    }
                  }
                }
                ... on ProjectV2ItemFieldDateValue {
                  __typename
                  date
                  field {
                    ... on ProjectV2FieldCommon {
                      name
                    }
                  }
                }
                ... on ProjectV2ItemFieldIterationValue {
                  __typename
                  title
                  startDate
                  duration
                  field {
                    ... on ProjectV2FieldCommon {
                      name
                    }
                  }
                }
                ... on ProjectV2ItemFieldPullRequestValue {
                  __typename
                  pullRequests(first: 20) {
                    nodes {
                      url
                      number
                      title
                      state
                      repository {
                        owner { login }
                        name
                      }
                    }
                  }
                  field {
                    ... on ProjectV2FieldCommon {
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// 프로젝트의 필드 정보 조회
export const GET_PROJECT_V2_FIELDS = `
  query GetProjectV2Fields($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 50) {
          nodes {
            ... on ProjectV2Field {
              id
              name
              dataType
            }
            ... on ProjectV2SingleSelectField {
              id
              name
              dataType
              options {
                id
                name
                color
              }
            }
            ... on ProjectV2IterationField {
              id
              name
              dataType
              configuration {
                iterations {
                  id
                  title
                  startDate
                  duration
                }
              }
            }
          }
        }
      }
    }
  }
`;

// 특정 아이템 조회
export const GET_PROJECT_V2_ITEM = `
  query GetProjectV2Item($itemId: ID!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        id
        type
        content {
          ... on Issue {
            __typename
            id
            number
            title
            state
            url
            body
            repository {
              owner { login }
              name
            }
            createdAt
            updatedAt
            assignees(first: 10) {
              nodes {
                login
                name
              }
            }
            labels(first: 20) {
              nodes {
                name
                color
              }
            }
            timelineItems(first: 50) {
              nodes {
                ... on ConnectedEvent {
                  __typename
                  createdAt
                  subject {
                    ... on PullRequest {
                      __typename
                      url
                      number
                      title
                      state
                    }
                  }
                }
                ... on CrossReferencedEvent {
                  __typename
                  createdAt
                  source {
                    ... on PullRequest {
                      __typename
                      url
                      number
                      title
                      state
                    }
                  }
                }
              }
            }
          }
          ... on PullRequest {
            __typename
            id
            number
            title
            state
            url
            body
            repository {
              owner { login }
              name
            }
            createdAt
            updatedAt
            assignees(first: 10) {
              nodes {
                login
                name
              }
            }
            labels(first: 20) {
              nodes {
                name
                color
              }
            }
          }
        }
        fieldValues(first: 50) {
          nodes {
            ... on ProjectV2ItemFieldTextValue {
              __typename
              text
              field {
                ... on ProjectV2FieldCommon {
                  name
                }
              }
            }
            ... on ProjectV2ItemFieldSingleSelectValue {
              __typename
              name
              optionId
              field {
                ... on ProjectV2FieldCommon {
                  name
                }
              }
            }
            ... on ProjectV2ItemFieldNumberValue {
              __typename
              number
              field {
                ... on ProjectV2FieldCommon {
                  name
                }
              }
            }
            ... on ProjectV2ItemFieldDateValue {
              __typename
              date
              field {
                ... on ProjectV2FieldCommon {
                  name
                }
              }
            }
            ... on ProjectV2ItemFieldIterationValue {
              __typename
              title
              startDate
              duration
              field {
                ... on ProjectV2FieldCommon {
                  name
                }
              }
            }
            ... on ProjectV2ItemFieldPullRequestValue {
              __typename
              pullRequests(first: 20) {
                nodes {
                  url
                  number
                  title
                  state
                  repository {
                    owner { login }
                    name
                  }
                }
              }
              field {
                ... on ProjectV2FieldCommon {
                  name
                }
              }
            }
          }
        }
      }
    }
  }
`;

// 뷰어(현재 사용자) 정보 조회 (권한 확인용)
export const GET_VIEWER = `
  query GetViewer {
    viewer {
      login
      name
      email
    }
  }
`;

// 프로젝트 아이템 업데이트 뮤테이션
export const UPDATE_PROJECT_V2_ITEM_FIELD_VALUE = `
  mutation UpdateProjectV2ItemFieldValue(
    $projectId: ID!
    $itemId: ID!
    $fieldId: ID!
    $value: ProjectV2FieldValue!
  ) {
    updateProjectV2ItemFieldValue(
      input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: $value
      }
    ) {
      projectV2Item {
        id
      }
    }
  }
`;

// 프로젝트에 아이템 추가 뮤테이션
export const ADD_PROJECT_V2_ITEM_BY_ID = `
  mutation AddProjectV2ItemById($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(
      input: {
        projectId: $projectId
        contentId: $contentId
      }
    ) {
      item {
        id
      }
    }
  }
`;

// 프로젝트에서 아이템 제거 뮤테이션
export const DELETE_PROJECT_V2_ITEM = `
  mutation DeleteProjectV2Item($projectId: ID!, $itemId: ID!) {
    deleteProjectV2Item(
      input: {
        projectId: $projectId
        itemId: $itemId
      }
    ) {
      deletedItemId
    }
  }
`;